import * as functions from 'firebase-functions';
import * as firebase_admin from "firebase-admin";
import { CallableContext, HttpsError } from "firebase-functions/lib/providers/https";
import * as logging from '@google-cloud/logging';
import Stripe = require("stripe");
import FieldValue = firebase_admin.firestore.FieldValue;
import IPaymentIntent = Stripe.paymentIntents.IPaymentIntent;

// @ts-ignore
const runtimeOpts = {
    // timeoutSeconds: 300,
    memory: '128MB'
};



// @ts-ignore
const logger = new logging.Logging();
const admin = firebase_admin.initializeApp();
const db = admin.firestore();
const stripe = new Stripe(functions.config().stripe.test.secret_key);

enum HangerState {
    AVAILABLE,
    TAKEN
}

enum ReservationState { // noinspection JSUnusedGlobalSymbols
    CHECK_IN_REJECTED, CHECKED_OUT, CHECKED_IN, CHECKING_OUT, CHECKING_IN,
}

enum PaymentStatus {
    REFUNDED = -2, CANCELED = -1, INITIAL = 0, RESERVED = 1, CAPTURED = 2,
}

/**
 * Convenience function to create a https call function.
 * @param handler The call handler
 */
function onCall(handler: (data: any, context: functions.https.CallableContext) => any) {
    return functions.region('europe-west2').https.onCall(handler);
}

/**
 * Gets the firebase UID of the user who invoked the function.
 * @param context
 */
function getRequestingUserId(context: CallableContext) {
    // context.auth is undefined when running in the emulator, provide a default uid
    return context.auth === undefined ? 'UyasY6VeR4OY3R4Z3r2xFy9cASh2' : context.auth.uid;
}

// noinspection JSUnusedGlobalSymbols
async function getUserCustomerId(userId: string): Promise<string | null> {
    const user = await admin.auth().getUser(userId)
    if (user.customClaims && user.customClaims.hasOwnProperty('stripeId')) {
        return (user.customClaims as any).stripeId
    } else {
        console.error(Error(`Missing customClaims.stripeID for user: ${user.uid}`))
        return null
    }
}

/**
 * Create ephemeral key
 */
export const getEphemeralKey = onCall(async (data, context) => {
    const apiVersion = data.apiVersion;
    const customerId = await getUserCustomerId(getRequestingUserId(context));
    if (customerId === null) {
        throw new functions.https.HttpsError('failed-precondition', "User has no Stripe ID");
    }
    const key = stripe.ephemeralKeys.create(
        { customer: customerId },
        { stripe_version: apiVersion });
    return { key: key }
});

// noinspection JSUnusedGlobalSymbols
/**
 * When a new user is created, create and attach a stripe customer
 */
export const createStripeCustomer = functions.auth.user().onCreate(async (user, context) => {
    const customer = await stripe.customers.create({
        name: user.displayName,
        email: user.email,
        phone: user.phoneNumber,
        metadata: { uid: user.uid }
    });
    await admin.auth().setCustomUserClaims(user.uid, { stripeId: customer.id });
    // TODO: use data from login provider
    return admin.firestore().collection('users').doc(user.uid).set({
        stripeId: customer.id,
        name: user.displayName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        photoUrl: user.photoURL
    }, { merge: true });
});

// noinspection JSUnusedGlobalSymbols
/**
 * When a user is deleted, delete any attaches stripe customers
 */
export const cleanupStripeCustomer = functions.auth.user().onDelete(async (user, context) => {
    const stripeId = await getUserCustomerId(user.uid);
    if (stripeId !== null) {
        await stripe.customers.del(stripeId);
    } else {
        console.error(new Error(`Unable to find and delete stripe ID for user ${user.uid}.}`))
    }
});

// noinspection JSUnusedGlobalSymbols,JSUnusedLocalSymbols
/**
 * Requests a check-out
 */
export const requestCheckOut = onCall(async (data, context) => {
    const reservation: string = data.reservation;
    const ref = db.doc(`reservations/${reservation}`);
    const newData = {
        state: ReservationState.CHECKING_OUT,
        stateUpdated: FieldValue.serverTimestamp()
    };
    const wr = await ref.update(newData);
    return { writeTime: wr.writeTime };
});


// noinspection JSUnusedGlobalSymbols
export const confirmCheckIn = onCall(async (data, context) => {
    const reservation: string = data.reservation;
    const ref = db.doc(`reservations/${reservation}`);
    const payload = {
        checkIn: FieldValue.serverTimestamp(),
        stateUpdated: FieldValue.serverTimestamp(),
        state: ReservationState.CHECKED_IN
    };
    const wr = await ref.update(payload);
    return { writeTime: wr.writeTime };
});

// noinspection JSUnusedGlobalSymbols
export const confirmCheckOut = onCall(async (data, context) => {
    const reservationRef = db.doc(`reservations/${data.reservation}`);
    const reservation = await reservationRef.get();

    const batch = db.batch();
    const reservationData = {
        checkOut: FieldValue.serverTimestamp(),
        stateUpdated: FieldValue.serverTimestamp(),
        state: ReservationState.CHECKED_OUT
    };
    batch.update(reservationRef, reservationData, { lastUpdateTime: reservation.updateTime });

    const hangerRef = reservation.get('hanger');
    const hangerData = {
        state: HangerState.AVAILABLE,
        stateUpdated: FieldValue.serverTimestamp()
    };
    batch.update(hangerRef, hangerData);
    const wr = await batch.commit();
    return { reservationUpdated: wr[0].writeTime, hangerUpdated: wr[1].writeTime }


});

async function createReservation(hanger: FirebaseFirestore.QueryDocumentSnapshot, venueRef: FirebaseFirestore.DocumentReference, context: CallableContext, sectionRef: FirebaseFirestore.DocumentReference, wardrobeRef: FirebaseFirestore.DocumentReference, paymentIntentId: string, paymentStatus: PaymentStatus) {
    const hangerName: string = await hanger.get('id');
    const venueName = (await venueRef.get()).get('name');
    const userId = getRequestingUserId(context);
    const userRef = db.doc(`users/${userId}`);
    const userName = (await userRef.get()).get('name');

    const reservationData = {
        section: sectionRef,
        hanger: hanger.ref,
        hangerName: hangerName,
        user: userRef,
        userName: userName,
        venue: venueRef,
        venueName: venueName,
        wardrobe: wardrobeRef,
        state: ReservationState.CHECKING_IN,
        reservationTime: FieldValue.serverTimestamp(),
        paymentIntent: paymentIntentId,
        paymentStatus: paymentStatus
    };
    return await db.collection('reservations').add(reservationData)
}

// noinspection JSUnusedGlobalSymbols
/**
 * Confirm an existing reservation after 3ds authentication or with a different payment method.
 */
export const confirmPayment = onCall(async (data, context) => {
    const paymentIntentId = data.paymentIntentId;
    const paymentData = 'paymentMethodId' in data ? { payment_method: data.paymentIntentId } : {};
    const intent = await stripe.paymentIntents.confirm(paymentIntentId, paymentData);

    const snapshot = await admin.firestore().collectionGroup('reservations').where('paymentIntent', "==", paymentIntentId).limit(1).get();
    const reservation = snapshot.docs[0];
    const status = intentToStatus(intent);
    await reservation.ref.update('paymentStatus', status);
    return { status: intent.status, action: intent.next_action, paymentIntentClientSecret: intent.client_secret }
});

function intentToStatus(intent: IPaymentIntent) {
    if (intent.status === "succeeded") {
        return PaymentStatus.CAPTURED
    } else if (intent.status === "requires_capture") {
        return PaymentStatus.RESERVED
    } else if (intent.status === "requires_action") {
        return PaymentStatus.INITIAL
    } else if (intent.status === "requires_payment_method") {
        return PaymentStatus.INITIAL
    } else if (intent.status === "canceled") {
        return PaymentStatus.CANCELED
    } else if (intent.status === "processing") {
        console.error(intent.status);
        return PaymentStatus.INITIAL
    } else if (intent.status === "requires_confirmation") {
        return PaymentStatus.INITIAL
    }
    return PaymentStatus.INITIAL
}

// noinspection JSUnusedGlobalSymbols
/**
 * Requests a check-in.
 * Finds and available hanger, reserves it and creates a new reservation entry.
 *
 * Returns 'resource-exhausted' if there are no available hangers.
 */
export const requestCheckIn = onCall(async (data, context) => {

    // TODO: validate input
    const code = tokenize(data.code);
    const paymentMethodId = data.paymentMethodId;
    const userId = getRequestingUserId(context);

    const venueRef = db.doc(`/venues/${code.venueId}`);
    const wardrobeRef = db.doc(venueRef.path + `/wardrobes/${code.wardrobeId}`);
    const sectionRef = db.doc(wardrobeRef.path + `/sections/${code.sectionId}`);

    // TODO: BEGIN transaction
    const hanger = await findAvailableHanger(sectionRef);
    if (hanger === null) throw new HttpsError("resource-exhausted", "no hangers available", sectionRef.path);
    await reserveHanger(hanger.ref);
    // END transaction

    const user = await admin.firestore().collection('users').doc(userId).get();
    const customer_id = user.get('stripe_id');
    const user_email = user.get('email');

    // TODO: get amount from section
    // TODO: add statement descriptor
    // TODO: set description
    // TODO: set metadata to reservation ID
    // TODO: set transfer_data and application_fee
    const intent = await stripe.paymentIntents.create({
        customer: customer_id,
        payment_method: paymentMethodId,
        confirmation_method: "manual",
        amount: 2500,
        confirm: true,
        capture_method: "manual",
        currency: 'NOK',
        return_url: "https://www.google.com",
        receipt_email: user_email,
        payment_method_types: ['card'],
        setup_future_usage: "on_session"
    });

    const paymentStatus = intentToStatus(intent);
    await createReservation(hanger, venueRef, context, sectionRef, wardrobeRef, intent.id, paymentStatus);
    return { status: intent.status, action: intent.next_action }
});

/**
 * Reserves a hanger.
 * @param ref Reference to the hanger that should be reserved.
 */
function reserveHanger(ref: FirebaseFirestore.DocumentReference): Promise<FirebaseFirestore.WriteResult> {
    const data = { 'state': HangerState.TAKEN, 'stateUpdated': FieldValue.serverTimestamp() };
    return ref.update(data)
}

/**
 * Finds an available hanger, if any.
 * Returns an available hanger, or null if no hanger was found.
 * @param sectionRef The wardrobe section to search through.
 */
async function findAvailableHanger(sectionRef: FirebaseFirestore.DocumentReference): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
    const hangers = await db.collection(sectionRef.path + `/hangers`)
        .where('state', "==", HangerState.AVAILABLE)
        .limit(1)
        .get();
    return hangers.empty ? null : hangers.docs[0];
}


class QrCode {
    constructor(public venueId: string, public wardrobeId: string, public sectionId: string) {
    }

}

function tokenize(code: string): QrCode {
    // TODO: return the real values
    return new QrCode("aaXt3hxtb5tf8aTz1BNp", "E8blVz5KBFZoLOTLJGf1", "vnEpTisjoygX3UJFaMy2");
}

// @ts-ignore
async function reportError(err, context = {}): Promise<LogWriteResponse> {
    // This is the name of the StackDriver log stream that will receive the log
    // entry. This name can be any valid log stream name, but must contain "err"
    // in order for the error to be picked up by StackDriver Error Reporting.
    const logName = 'errors';
    const log = logger.log(logName);

    // https://cloud.google.com/logging/docs/api/ref_v2beta1/rest/v2beta1/MonitoredResource
    const meta = {
        resource: {
            type: 'cloud_functions', labels: {
                // @ts-ignore
                'function_name': process.env.FUNCTION_NAME.toString()
            }
        }
    };

    // https://cloud.google.com/error-reporting/reference/rest/v1beta1/ErrorEvent
    const errorEvent = {
        message: err.stack,
        serviceContext: {
            service: process.env.FUNCTION_NAME,
            resourceType: 'cloud_function',
        },
        context: context,
    };

    return log.write(log.entry(meta, errorEvent));
}

