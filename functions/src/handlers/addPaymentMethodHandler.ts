import * as functions from "firebase-functions";
import {getRequestingUserId, getStripeCustomerId, stripe} from "../utils";

export async function addPaymentMethodHandler(data: any, context: functions.https.CallableContext) {
    let setupIntent;

    if (data.setupIntentId === undefined) {
        setupIntent = await createSetupIntent(data, context)
    } else {
        setupIntent = await confirmSetupIntent(data, context)
    }
    return {status: setupIntent.status, clientSecret: setupIntent.client_secret};
}

async function createSetupIntent(data: any, context: functions.https.CallableContext) {
    const customerId = await getStripeCustomerId(getRequestingUserId(context));
    if (customerId === null) {
        throw new functions.https.HttpsError('failed-precondition', "User has no Stripe ID");
    }
    // TODO: add billing details
    const createPmResponse = await stripe.paymentMethods.create({card: {token: data.paymentMethodId}, type: "card"});
    // TODO: perform attach on the client
    const attachPmResponse = await stripe.paymentMethods.attach(createPmResponse.id, {customer: customerId});
    return await stripe.setupIntents.create({
        confirm: true,
        customer: customerId,
        payment_method: attachPmResponse.id,
        usage: 'on_session',
        return_url: data.returnUrl,
        payment_method_types: ["card"],
    });
}


async function confirmSetupIntent(data: any, context: functions.https.CallableContext) {
    // @ts-ignore
    return await stripe.setupIntents.confirm({
        return_url: data.returnUrl,
    });
}