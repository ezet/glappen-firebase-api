import * as functions from 'firebase-functions';

import {requestCheckInHandler} from "./handlers/requestCheckInHandler";
import {onCall} from "./utils";
import {getEphemeralKeyHandler} from "./handlers/getEphemeralKeyHandler";
import {addPaymentMethodHandler} from "./handlers/addPaymentMethodHandler";
import {setupUserHandler} from "./handlers/setupUserHandler";
import {cleanupUserHandler} from "./handlers/cleanupUserHandler";
import {confirmPaymentHandler} from "./handlers/confirmPaymentHandler";
import {confirmCheckInHandler} from "./handlers/confirmCheckInHandler";
import {requestCheckOutHandler} from "./handlers/requestCheckOutHandler";
import {confirmCheckOutHandler} from "./handlers/confirmCheckOutHandler";
import {cancelCheckInHandler} from "./handlers/cancelCheckInhandler";
import {timeoutIntervalMinutes, timeoutReservationsHandler} from "./handlers/timeoutReservationHandler";


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
/**
 * Cancel an on-going check-in
 */
export const cancelCheckIn = onCall(cancelCheckInHandler);

// noinspection JSUnusedGlobalSymbols
export const timeoutTask = functions.runWith({memory: memory}).region(region).pubsub.schedule(`every ${timeoutIntervalMinutes} minutes`).onRun(timeoutReservationsHandler);
