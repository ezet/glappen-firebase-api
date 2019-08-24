import {EventContext} from "firebase-functions";
import {DocumentReference, Timestamp} from "@google-cloud/firestore";
import {admin, db, HangerState, stripe} from "../utils";

/**
 * Minimum time passed before a reservation is timed out
 * Maximum duration is defined by `timeoutIntervalMinutes` + `timeoutDelayMinutes`
 */
const timeoutDelayMinutes = 5;

/**
 * Interval between each run of timeoutReservationTask
 */
export const timeoutIntervalMinutes = 5;


// noinspection JSUnusedLocalSymbols
export async function timeoutReservationsHandler(context: EventContext) {

    const timeoutDelayMs = timeoutDelayMinutes * 60 * 1000;
    const fiveMinutesAgo = Timestamp.fromMillis(Timestamp.now().toMillis() - timeoutDelayMs);
    const reservations = await admin.firestore().collection('reservations').where('reservationTime', "<", fiveMinutesAgo).where('eligibleForTimeout', '==', true).get();
    const promiseArray: Promise<any>[] = [];
    console.log(`Cleaning up ${reservations.docs.length} reservations...`);
    reservations.forEach(item => {
        const batch = db.batch();
        const paymentIntentId = item.get('paymentIntent');
        promiseArray.push(stripe.paymentIntents.cancel(paymentIntentId));
        const hanger = item.get('hanger');
        if (hanger instanceof DocumentReference) {
            batch.update(hanger, 'state', HangerState.AVAILABLE);
        }

        batch.update(item.ref, 'timeout', true, 'visibleInApp', false, 'visibleInAdmin', false);
        promiseArray.push(batch.commit());
    });
    return Promise.all(promiseArray);
}