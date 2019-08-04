import * as functions from 'firebase-functions';
import * as admin from "firebase-admin";
import {CallableContext, HttpsError} from "firebase-functions/lib/providers/https";
import FieldValue = admin.firestore.FieldValue;

enum HangerState {
    AVAILABLE,
    TAKEN
}

// @ts-ignore
// noinspection JSUnusedLocalSymbols
const runtimeOpts = {
    // timeoutSeconds: 300,
    memory: '128MB'
};


const db = admin.firestore(admin.initializeApp());

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


/**
 * Reserves a hanger.
 * @param ref Reference to the hanger that should be reserved.
 */
function reserveHanger(ref: FirebaseFirestore.DocumentReference): Promise<FirebaseFirestore.WriteResult> {
    const data = {'state': HangerState.TAKEN, 'stateUpdated': FieldValue.serverTimestamp()};
    return ref.update(data)
}


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

enum ReservationState { // noinspection JSUnusedGlobalSymbols
    CHECK_IN_REJECTED, CHECKED_OUT, CHECKED_IN, CHECKING_OUT, CHECKING_IN
}


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

class QrCode {
    constructor(public venueId: string, public wardrobeId: string, public sectionId: string) {
    }

}

function tokenize(code: string) {
    // TODO: return the real values
    return new QrCode("aaXt3hxtb5tf8aTz1BNp", "E8blVz5KBFZoLOTLJGf1", "vnEpTisjoygX3UJFaMy2");
}