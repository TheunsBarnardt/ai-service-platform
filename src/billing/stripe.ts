import Stripe from 'stripe';
import { config } from '../config/index.js';
import { fundCallerAccount } from './engine.js';
import { logger } from '../utils/logger.js';

let stripe: Stripe | null = null;

function getStripe(): Stripe | null {
  if (stripe) return stripe;
  if (!config.stripe.secretKey) {
    logger.warn('Stripe secret key not configured; Stripe operations will return stubs');
    return null;
  }
  stripe = new Stripe(config.stripe.secretKey, { apiVersion: '2025-02-24.acacia' });
  return stripe;
}

export interface PaymentIntentResult {
  clientSecret: string;
  paymentIntentId: string;
}

/**
 * Creates a Stripe PaymentIntent for a caller to fund their account.
 * Returns a stub response if Stripe is not configured.
 */
export async function createPaymentIntent(
  amountCents: number,
  callerId: string,
  metadata?: Record<string, string>,
): Promise<PaymentIntentResult> {
  const stripeClient = getStripe();

  if (!stripeClient) {
    logger.warn({ callerId, amountCents }, 'Stripe not configured, returning stub PaymentIntent');
    return {
      clientSecret: 'stub_client_secret',
      paymentIntentId: 'stub_pi_' + Date.now(),
    };
  }

  const paymentIntent = await stripeClient.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    metadata: {
      caller_id: callerId,
      ...metadata,
    },
  });

  logger.info(
    { paymentIntentId: paymentIntent.id, callerId, amountCents },
    'PaymentIntent created',
  );

  return {
    clientSecret: paymentIntent.client_secret!,
    paymentIntentId: paymentIntent.id,
  };
}

export interface WebhookResult {
  handled: boolean;
}

/**
 * Verifies a Stripe webhook signature and processes the event.
 * Currently handles payment_intent.succeeded to automatically
 * fund the caller's account.
 */
export async function handleWebhook(
  body: Buffer,
  signature: string,
): Promise<WebhookResult> {
  const stripeClient = getStripe();

  if (!stripeClient) {
    logger.warn('Stripe not configured, webhook ignored');
    return { handled: false };
  }

  let event: Stripe.Event;
  try {
    event = stripeClient.webhooks.constructEvent(
      body,
      signature,
      config.stripe.webhookSecret,
    );
  } catch (err) {
    logger.error({ err }, 'Stripe webhook signature verification failed');
    throw new Error('Invalid webhook signature');
  }

  logger.info({ eventType: event.type, eventId: event.id }, 'Stripe webhook received');

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const callerId = paymentIntent.metadata?.caller_id;

    if (!callerId) {
      logger.warn({ paymentIntentId: paymentIntent.id }, 'PaymentIntent missing caller_id metadata');
      return { handled: false };
    }

    await fundCallerAccount(callerId, paymentIntent.amount, paymentIntent.id);

    logger.info(
      { callerId, amountCents: paymentIntent.amount, paymentIntentId: paymentIntent.id },
      'Payment processed via webhook',
    );

    return { handled: true };
  }

  return { handled: false };
}
