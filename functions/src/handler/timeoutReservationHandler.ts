import {EventContext} from "firebase-functions";
import {DocumentReference, Timestamp} from "@google-cloud/firestore";
import {admin, HangerState, stripe} from "../utils";

export async function timeoutReservationsHandler(context: EventContext) {
    const fiveMinutesAgo = Timestamp.fromMillis(Timestamp.now().toMillis() - 60 * 5 * 1000);
    const reservations = await admin.firestore().collection('reservations').where('reservationTime', "<", fiveMinutesAgo).where('eligibleForTimeout', '==', true).get();
    const promiseArray: Promise<any>[] = [];
    console.log(`Cleaning up ${reservations.docs.length} reservations...`);
    reservations.forEach(item => {
        const paymentIntentId = item.get('paymentIntent');
        promiseArray.push(stripe.paymentIntents.cancel(paymentIntentId));
        const hanger = item.get('hanger');
        if (hanger instanceof DocumentReference) {
            promiseArray.push(hanger.update('state', HangerState.AVAILABLE));
        }
        promiseArray.push(item.ref.update('timeout', true, 'visibleInApp', false, 'visibleInAdmin', false));
    });
    return Promise.all(promiseArray);
}