import * as functions from "firebase-functions";
import {adminVisibilityForState, clientVisibilityForState, db, ReservationState} from "../utils";
import {FieldValue} from "@google-cloud/firestore";

export async function confirmCheckInHandler(data: any, context: functions.https.CallableContext) {
    const reservation: string = data.reservationId;
    const ref = db.doc(`reservations/${reservation}`);
    const newState = ReservationState.CHECKED_IN;
    const payload = {
        checkedIn: FieldValue.serverTimestamp(),
        stateUpdated: FieldValue.serverTimestamp(),
        state: newState,
        visibleInApp: clientVisibilityForState(newState),
        visibleInAdmin: adminVisibilityForState(newState)
    };
    const wr = await ref.update(payload);
    return {writeTime: wr.writeTime};
}