import * as functions from 'firebase-functions';
import * as admin from "firebase-admin";
import {HttpsError} from "firebase-functions/lib/providers/https";
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

async function findAvailableHanger(sectionRef: FirebaseFirestore.DocumentReference) {
    const hangers = await db.collection(sectionRef.path + `/hangers`)
        .where('state', "==", HangerState.AVAILABLE)
        .limit(1)
        .get();
    return hangers.empty ? null : hangers.docs[0];
}


function reserveHanger(ref: FirebaseFirestore.DocumentReference) {
    const data = {'state': HangerState.TAKEN, 'stateUpdated': FieldValue.serverTimestamp()};
    return ref.update(data)
}

// noinspection JSUnusedGlobalSymbols
export const createReservation = functions
    .region('europe-west2')
    .https.onCall(async (data, context) => {
        const code = tokenize(data.code);

        const venueRef = db.doc(`/venues/${code.venueId}`);

        const wardrobeRef = db.doc(venueRef.path + `/wardrobes/${code.wardrobeId}`);
        const sectionRef = db.doc(wardrobeRef.path + `/sections/${code.sectionId}`);
        const hanger = await findAvailableHanger(sectionRef);
        if (hanger === null) throw new HttpsError("resource-exhausted", "no hangers available", sectionRef.path);
        await reserveHanger(hanger.ref);
        const hangerName: string = await hanger.get('id');
        const venueName = (await venueRef.get()).get('name');

        // if (context.auth === undefined) throw new HttpsError("unauthenticated", "");
        const userId = context.auth === undefined ? 'UyasY6VeR4OY3R4Z3r2xFy9cASh2' : context.auth.uid;
        // const userId =


        const userRef = db.doc(`users/${userId}`);

        const reservationData = {
            section: sectionRef,
            hanger: hanger.ref,
            hangerName: hangerName,
            user: userRef,
            venue: venueRef,
            venueName: venueName,
            wardrobe: wardrobeRef,
            state: 4,
            reservationTime: FieldValue.serverTimestamp()
        };
        const ref = await db.collection('reservations').add(reservationData);
        return {reservation: ref};
    });

class QrCode {
    constructor(public venueId: string, public wardrobeId: string, public sectionId: string) {
    }

}

function tokenize(code: string) {
    return new QrCode("aaXt3hxtb5tf8aTz1BNp", "E8blVz5KBFZoLOTLJGf1", "vnEpTisjoygX3UJFaMy2");
}