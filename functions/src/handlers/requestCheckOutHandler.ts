import * as functions from "firebase-functions";
import {db, ReservationState} from "../utils";
import {FieldValue} from "@google-cloud/firestore";

export async function requestCheckOutHandler(data: any, context: functions.https.CallableContext) {
    const reservation: string = data.reservation;
    const ref = db.doc(`reservations/${reservation}`);
    const newData = {
        state: ReservationState.CHECKING_OUT,
        stateUpdated: FieldValue.serverTimestamp()
    };
    const wr = await ref.update(newData);
    return {writeTime: wr.writeTime};
}