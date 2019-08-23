import * as functions from "firebase-functions";
import {db, ReservationState} from "../utils";
import {FieldValue} from "@google-cloud/firestore";

export async function confirmCheckInHandler(data: any, context: functions.https.CallableContext) {
    const reservation: string = data.reservation;
    const ref = db.doc(`reservations/${reservation}`);
    const payload = {
        checkIn: FieldValue.serverTimestamp(),
        stateUpdated: FieldValue.serverTimestamp(),
        state: ReservationState.CHECKED_IN
    };
    const wr = await ref.update(payload);
    return {writeTime: wr.writeTime};
}