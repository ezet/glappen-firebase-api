import * as functions from "firebase-functions";
import {db, HangerState, ReservationState} from "../utils";
import {FieldValue} from "@google-cloud/firestore";

export async function confirmCheckOutHandler(data: any, context: functions.https.CallableContext) {
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
}