export const errors: Record<string, string> = {
  SCHEDULE_CONSENT_REQUIRED:
    "Confirm the recurring amounts, dates and maximum total before authorizing future savings with your PIN.",
  SCHEDULE_DATES_INVALID:
    "Start recurring savings from tomorrow or later. Choose an end date on or after the start, within one year.",
  SCHEDULE_CLOSED:
    "This savings instruction has already ended or been cancelled. Create a new one to continue.",
  AJO_FEE_TOO_HIGH:
    "Choose a lower cycle fee so it can fit within one reviewed payout and still leave money for the saver.",
  AJO_ALREADY_JOINED:
    "You already belong to this book with a different contribution agreement. Your existing amount and payout date have not changed.",
  INVITE_REVOKED:
    "Your organizer has withdrawn this invitation. Ask them for a new one. Existing contributions are unchanged.",
  INVITE_EXPIRED:
    "This invitation has expired. Ask your organizer for a fresh invitation.",
  AJO_CONSENT_REQUIRED:
    "Review the contribution rules and cycle fee, then confirm that you agree before joining.",
  AJO_TERMS_CHANGED:
    "These collection terms changed. Check the latest invitation before agreeing.",
  AJO_TERMS_REVIEW_REQUIRED:
    "The organizer needs to refresh this book’s invitation and rules before new savers can join.",
  AJO_FEE_EXCEEDS_CYCLE:
    "This cycle fee would use all the planned contributions. Agree a lower fee or a longer cycle first.",
  AJO_PAYOUT_TOO_SMALL:
    "This payout is too small to cover the agreed cycle fee. Choose a larger principal amount so the saver receives money.",
  AJO_PAYOUT_CHANGED:
    "A previous payout changed the fee still due. Prepare a fresh payout review. This task was not charged.",
  AJO_PRIVATE_JOIN_REQUIRED:
    "The saver must review and accept their membership privately. An organizer cannot link another person’s account for them.",
  AI_MEMBERSHIP_FIRST:
    "Review and accept the Ajo membership first, then prepare its contribution. Your other requested details are still saved.",
  AJO_RULES_INVALID:
    "Add clear collection rules using no more than 500 characters.",
  INVALID_AJO_PERIOD:
    "Choose valid contribution dates, from the start through the payout date, within one year.",
  AJO_CYCLE_EXCEEDED:
    "This amount is more than the remaining contributions for this cycle. Reduce it or agree a new cycle first.",
  AJO_ALLOCATION_CHANGED:
    "Another contribution changed the days covered. Prepare a fresh review so you can approve the correct dates. This task was not charged.",
  AJO_RECORD_REVIEW_REQUIRED:
    "This older collection book needs its contribution history checked before dated payments can be added. Its funds have not changed.",
  REQUEST_EXPIRED:
    "This unfinished request is more than 24 hours old. Send a new request. Your completed transactions are unchanged.",
  INVALID_METER_NUMBER:
    "Check the meter number. It should contain 10 to 13 digits for this test electricity service.",
  INVALID_STATEMENT_PERIOD:
    "Choose a valid start and end date within one year.",
  STATEMENT_TOO_LARGE:
    "That statement has too many entries for one download. Choose a shorter period.",
  AUDIO_TOO_LONG:
    "That voice note is longer than 90 seconds. Send a shorter note so every instruction can be reviewed together.",
  AUDIO_DECODER_UNAVAILABLE:
    "Voice-note processing is not available on this server yet. Please send the request as text. No payment was approved.",
  INVALID_COLLECTION_DATE:
    "A cash collection cannot be recorded for a future date. Check the date and try again.",
  IMPORT_ALREADY_RECORDED:
    "This notebook row was already recorded. It has not been added twice.",
  MEDIA_UNAVAILABLE:
    "I could not load that voice note or picture. Please send it again. Your earlier request is still saved.",
  MEDIA_UNREADABLE:
    "I could not read that clearly. Send a clearer picture or repeat the missing details. No payment was approved.",
  MEDIA_TOO_LARGE:
    "That file is too large. Send a picture or voice note smaller than 8 MB.",
  MEDIA_TYPE_UNSUPPORTED:
    "Please send a JPEG, PNG or WebP picture, or a WhatsApp voice note.",
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
