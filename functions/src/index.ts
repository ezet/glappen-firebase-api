import * as functions from 'firebase-functions';
import * as firebase_admin from "firebase-admin";
import {CallableContext, HttpsError} from "firebase-functions/lib/providers/https";
import * as logging from '@google-cloud/logging';
import {Error} from "tslint/lib/error";
import Stripe = require("stripe");
import FieldValue = firebase_admin.firestore.FieldValue;
import IPaymentIntent = Stripe.paymentIntents.IPaymentIntent;

// @ts-ignore
// noinspection JSUnusedLocalSymbols
const runtimeOpts = {
    // timeoutSeconds: 300,
    memory: '128MB'
};

const logger = new logging.Logging();
const admin = firebase_admin.initializeApp();
const db = admin.firestore();
const stripe = new Stripe('sk_test_ATY8QjLKqZMGA4DY64SaOhoe0091RWsvuT');

enum HangerState {
    AVAILABLE,
    TAKEN
}

enum ReservationState { // noinspection JSUnusedGlobalSymbols
    CHECK_IN_REJECTED, CHECKED_OUT, CHECKED_IN, CHECKING_OUT, CHECKING_IN
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
function getUser(context: CallableContext) {
    // context.auth is undefined when running in the emulator, provide a default uid
    return context.auth === undefined ? 'UyasY6VeR4OY3R4Z3r2xFy9cASh2' : context.auth.uid;
}

/**
 * When a new user is created, create and attach a stripe customer
 */
export const createStripeCustomer = functions.auth.user().onCreate(async (user, context) => {
    const customer = await stripe.customers.create({
        name: user.displayName,
        email: user.email,
        phone: user.phoneNumber,
        metadata: {uid: user.uid}
    });
    await admin.auth().setCustomUserClaims(user.uid, {stripe_id: customer.id});
    return {}
});

/**
 * When a user is deleted, delete any attaches stripe customers
 */
export const cleanupStripeCustomer = functions.auth.user().onDelete(async (user, context) => {
    const claims = user.customClaims !== undefined ? user.customClaims : {};
    if ('stripe_id' in claims) {
        // @ts-ignore
        await stripe.customers.del(claims.stripe_id);
    } else {
        console.error((new Error(`Unable to clean up stripe customer for user ${user.uid}. Claims: ${claims.toString()}`)))
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
    return {writeTime: wr.writeTime};
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
    return {writeTime: wr.writeTime};
});

export const requestPaymentIntent = onCall(async (data, context) => {
    let intent: IPaymentIntent;
    if (data.paymentMethodId !== undefined) {
        const paymentMethodId = data.paymentMethodId;
        intent = await stripe.paymentIntents.create({
            payment_method: paymentMethodId,
            amount: 2500,
            currency: 'nok',
            payment_method_types: ['card'],
            confirmation_method: "manual",
            confirm: true,
            customer: 'cus_FXX6ahUoQ3Eqb7',
            return_url: 'https://www.vg.no',
        });
    } else if (data.paymentIntentId !== undefined) {
        intent = await stripe.paymentIntents.confirm(data.paymentIntentId);
    } else {
        return {}
    }
    if (intent.status === "requires_action") {
        console.log(intent.next_action);
        return {requiresAction: true, action: intent.next_action, paymentIntentClientSecret: intent.client_secret}
    } else if (intent.status === "succeeded") {
        return {success: true};
    } else {
        console.error(intent.status);
        console.error(intent.last_payment_error);
        return {error: intent.status};
    }
});

export const confirmCheckOut = onCall(async (data, context) => {
    const reservationRef = db.doc(`reservations/${data.reservation}`);
    const reservation = await reservationRef.get();

    const batch = db.batch();
    const reservationData = {
        checkOut: FieldValue.serverTimestamp(),
        stateUpdated: FieldValue.serverTimestamp(),
        state: ReservationState.CHECKED_OUT
    };
    batch.update(reservationRef, reservationData, {lastUpdateTime: reservation.updateTime});

    const hangerRef = reservation.get('hanger');
    const hangerData = {
        state: HangerState.AVAILABLE,
        stateUpdated: FieldValue.serverTimestamp()
    };
    batch.update(hangerRef, hangerData);
    const wr = await batch.commit();
    return {reservationUpdated: wr[0].writeTime, hangerUpdated: wr[1].writeTime}


});

async function createReservation(hanger: FirebaseFirestore.QueryDocumentSnapshot, venueRef: FirebaseFirestore.DocumentReference, context: functions.https.CallableContext, sectionRef: FirebaseFirestore.DocumentReference, wardrobeRef: FirebaseFirestore.DocumentReference) {
    const hangerName: string = await hanger.get('id');
    const venueName = (await venueRef.get()).get('name');
    const userId = getUser(context);
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
        reservationTime: FieldValue.serverTimestamp()
    };
    const ref = await db.collection('reservations').add(reservationData);
    return {reservation: ref.path};
}

// noinspection JSUnusedGlobalSymbols
/**
 * Requests a check-in.
 * Finds and available hanger, reserves it and creates a new reservation entry.
 *
 * Returns 'resource-exhausted' if there are no available hangers.
 */
export const requestCheckIn = onCall(async (data, context) => {
    const code = tokenize(data.code);
    const venueRef = db.doc(`/venues/${code.venueId}`);
    const wardrobeRef = db.doc(venueRef.path + `/wardrobes/${code.wardrobeId}`);
    const sectionRef = db.doc(wardrobeRef.path + `/sections/${code.sectionId}`);
    const hanger = await findAvailableHanger(sectionRef);
    if (hanger === null) throw new HttpsError("resource-exhausted", "no hangers available", sectionRef.path);
    // TODO: wrap in transaction
    await reserveHanger(hanger.ref);
    return await createReservation(hanger, venueRef, context, sectionRef, wardrobeRef);
});

/**
 * Reserves a hanger.
 * @param ref Reference to the hanger that should be reserved.
 */
function reserveHanger(ref: FirebaseFirestore.DocumentReference): Promise<FirebaseFirestore.WriteResult> {
    const data = {'state': HangerState.TAKEN, 'stateUpdated': FieldValue.serverTimestamp()};
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

function tokenize(code: string) {
    // TODO: return the real values
    return new QrCode("aaXt3hxtb5tf8aTz1BNp", "E8blVz5KBFZoLOTLJGf1", "vnEpTisjoygX3UJFaMy2");
}