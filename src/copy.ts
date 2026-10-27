export const errors: Record<string, string> = {
  ASSISTANT_BUSY:
    "Your current request is still being prepared. Wait for its result before clearing the conversation.",
  CONVERSATION_LIMIT:
    "This conversation has reached its limit. Start a new conversation to continue. Your approved transactions are unchanged.",
  AI_SPLIT_PLAN:
    "I could not combine the tasks into one safe review. Your details are saved. Please try again.",
  INVALID_PIN:
    "That PIN did not match. Check your four-digit transaction PIN and try again.",
  INVALID_PIN_FORMAT: "Enter a four-digit transaction PIN.",
  PIN_LOCKED:
    "Too many PIN attempts. Please wait 15 minutes before trying again.",
  INSUFFICIENT_FUNDS:
    "Your available balance cannot cover all these tasks. Reduce an amount or remove a task.",
  REVIEW_EXPIRED:
    "This review has expired. Prepare a fresh review before approving.",
  REVIEW_CHANGED:
    "This review changed. Check the latest details before approving.",
  REVIEW_ALREADY_OPEN:
    "You have a review waiting. Complete or cancel it before starting another.",
  REVIEW_CLOSED: "This review is no longer open. Check its current status.",
  AI_NOT_CONFIGURED:
    "The assistant is not connected yet. You can still use the payment and savings forms.",
  AI_QUOTA:
    "The assistant has reached its provider limit. Please try again shortly. No new payment was authorized.",
  AI_UNAVAILABLE:
    "The assistant could not connect. Your unfinished request is saved. Please try again.",
  AI_NEEDS_RETRY:
    "I could not finish preparing the request. Your earlier details are saved. Please try again.",
  INVALID_RECIPIENT:
    "Check the bank and enter the complete ten-digit account number.",
  RECIPIENT_NOT_AVAILABLE:
    "That PayWella recipient is not available. Check the number or use a bank transfer.",
  SESSION_REQUIRED:
    "Open a fresh secure link from PayWella on WhatsApp to continue.",
  LINK_EXPIRED:
    "This link has expired or was already used. Ask PayWella for a fresh one.",
  FORBIDDEN: "This action is not available for your account.",
  NOT_FOUND: "We could not find that item in your account.",
  SETUP_REQUIRED: "Finish opening your account first.",
  REQUEST_INVALID: "Check the highlighted details and try again.",
  REQUEST_LIMIT: "Too many requests. Please wait a moment before trying again.",
  PROVIDER_UNCONFIRMED:
    "The payment provider has not confirmed this task yet. We are checking its reference. Please do not send it again.",
  ORGANIZER_REQUIRED:
    "Organizer access is required to create a collection book.",
  INVITE_NOT_FOUND:
    "That invitation was not found. Check the code with your organizer.",
  REPLACEMENT_EXCEEDS_CASH:
    "This amount is higher than the cash recorded as outstanding for this member.",
  NOT_MATURED: "This contribution has not reached its agreed payout date.",
  MEMBER_ACCOUNT_REQUIRED:
    "The member needs a linked PayWella account before receiving this payout.",
  PRODUCT_QUOTE_CHANGED:
    "That service amount is not available. Check the current product and price.",
  INVALID_CUSTOMER_NUMBER: "Enter a valid eleven-digit Nigerian phone number.",
  ALREADY_OPEN:
    "This account is already open. Ask PayWella for a sign-in link.",
  UNAVAILABLE:
    "We could not complete that step. Check the current task status before trying again.",
};
export const errorCopy = (code: string) => errors[code] || errors.UNAVAILABLE;
