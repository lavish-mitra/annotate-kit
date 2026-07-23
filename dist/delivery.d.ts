import { a as Annotation } from './types-BLXmj4Oi.js';

type Delivery = {
    /** Button label shown in the Send panel. */
    label: string;
    /** URL target — opens a prefilled page in a new tab (no token needed). */
    href?: (items: Annotation[]) => string;
    /** POST target — invoked on click (webhook / Slack / your API). */
    run?: (items: Annotation[]) => Promise<void> | void;
};
/** Zero-config: open a prefilled "New issue" page for a GitHub repo. No token required. */
declare function githubIssueDelivery(opts: {
    repo: string;
    label?: string;
    titlePrefix?: string;
}): Delivery;
/** POST the markdown prompt + structured context to any HTTP endpoint you control. */
declare function createWebhookDelivery(opts: {
    url: string;
    label?: string;
    headers?: Record<string, string>;
    fetch?: typeof fetch;
}): Delivery;
/** POST the prompt to a Slack Incoming Webhook URL (the integrator creates it). */
declare function createSlackDelivery(opts: {
    webhookUrl: string;
    label?: string;
    fetch?: typeof fetch;
}): Delivery;

export { type Delivery, createSlackDelivery, createWebhookDelivery, githubIssueDelivery };
