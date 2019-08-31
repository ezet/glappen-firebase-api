import * as functions from "firebase-functions";
import {admin, adminVisibilityForState, clientVisibilityForState, intentToStatus, stripe} from "../utils";

export async function confirmPaymentHandler(data: any, context: functions.https.CallableContext) {
    console.log(data);
    const reservation = await admin.firestore().collection('reservations').doc(data.reservationId).get();
    const paymentIntentId = reservation.get('paymentIntent');
    const paymentData = 'paymentMethodId' in data ? {payment_method: data.paymentIntentId} : {};
    const intent = await stripe.paymentIntents.confirm(paymentIntentId, paymentData);
    const status = intentToStatus(intent);
    await reservation.ref.update({
        state: status,
        visibleInApp: clientVisibilityForState(status),
        visibleInAdmin: adminVisibilityForState(status)
    });
    return {status: intent.status, nextAction: intent.next_action, clientSecret: intent.client_secret}
}