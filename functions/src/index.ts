import * as functions from 'firebase-functions';

import {requestCheckInHandler} from "./handlers/requestCheckInHandler";
import {admin, HangerState, onCall, stripe} from "./utils";
import {getEphemeralKeyHandler} from "./handlers/createEphemeralKeyHandler";
import {addPaymentMethodHandler} from "./handlers/addPaymentMethodHandler";
import {setupUserHandler} from "./handlers/setupUserHandler";
import {cleanupUserHandler} from "./handlers/cleanupUserHandler";
import {confirmPaymentHandler} from "./handlers/confirmPaymentHandler";
import {confirmCheckInHandler} from "./handlers/confirmCheckInHandler";
import {requestCheckOutHandler} from "./handlers/requestCheckOutHandler";
import {confirmCheckOutHandler} from "./handlers/confirmCheckOutHandler";
import {DocumentReference, Timestamp} from '@google-cloud/firestore';


const region = "europe-west2";
const memory = "128MB";


// noinspection JSUnusedGlobalSymbols
/**
 * Add payment method
 */
export const addPaymentMethod = onCall(addPaymentMethodHandler);

// noinspection JSUnusedGlobalSymbols
/**
 * Create ephemeral key
 */
export const getEphemeralKey = onCall(getEphemeralKeyHandler);

// noinspection JSUnusedGlobalSymbols
/**
 * When a new user is created, create and attach a stripe customer
 */
export const setupUser = functions.runWith({memory: memory}).region(region).auth.user().onCreate(setupUserHandler);

// noinspection JSUnusedGlobalSymbols
/**
 * When a user is deleted, delete any attaches stripe customers
 */
export const cleanupUser = functions.runWith({memory: memory}).region(region).auth.user().onDelete(cleanupUserHandler);


// noinspection JSUnusedGlobalSymbols
export const requestCheckIn = onCall(requestCheckInHandler);

// noinspection JSUnusedGlobalSymbols
/**
 * Confirm an existing reservation after 3ds authentication or with a different payment method.
 */
export const confirmPayment = onCall(confirmPaymentHandler);


// noinspection JSUnusedGlobalSymbols
export const confirmCheckIn = onCall(confirmCheckInHandler);


// noinspection JSUnusedGlobalSymbols,JSUnusedLocalSymbols
/**
 * Requests a check-out
 */
export const requestCheckOut = onCall(requestCheckOutHandler);

// noinspection JSUnusedGlobalSymbols
export const confirmCheckOut = onCall(confirmCheckOutHandler);

// noinspection JSUnusedGlobalSymbols
export const timeoutReservations = functions.runWith({memory: memory}).region(region).pubsub.schedule('every 5 minutes').onRun(async context => {
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
});
