import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, LoaderCircle, ShieldCheck } from "lucide-react";
type Item = Record<string, any>;
const money = (kobo: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    kobo / 100,
  );
export function feeDescription(policy: Item, dailyKobo?: number) {
  return policy?.kind === "fixed"
    ? money(policy.amountKobo) + " per cycle"
    : policy?.kind === "one_day"
      ? (dailyKobo ? money(dailyKobo) : "One daily contribution") +
        ", once per cycle"
      : "No organizer fee";
}
export function AgreementCheck({
  children,
  name = "consent",
  checked,
  onChange,
}: {
  children: React.ReactNode;
  name?: string;
  checked?: boolean;
  onChange?: (value: boolean) => void;
}) {
  return (
    <label className="agreement-check">
      <input
        name={name}
        type="checkbox"
        required
        checked={checked}
        onChange={(event) => onChange?.(event.target.checked)}
      />
      <span className="agreement-box" aria-hidden="true">
        <Check size={28} strokeWidth={3} />
      </span>
      <span>{children}</span>
    </label>
  );
}
async function read(path: string) {
  const response = await fetch("/api/" + path, {
      credentials: "same-origin",
      signal: AbortSignal.timeout(10000),
    }),
    value = await response.json();
  if (!response.ok)
    throw Error(
      value.message || "The invitation could not be checked. Please try again.",
    );
  return value;
}
export function AjoJoin({
  invite = "",
  proposalId,
  submit,
}: {
  invite?: string;
  proposalId?: string | null;
  submit: (value: Item) => Promise<void>;
}) {
  const [code, setCode] = useState(invite),
    [book, setBook] = useState<Item | null>(null),
    [amount, setAmount] = useState(""),
    [start, setStart] = useState(
      new Date(Date.now() + 3600000).toISOString().slice(0, 10),
    ),
    [end, setEnd] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    request = useRef(0);
  useEffect(() => {
    if (!proposalId) return;
    let mounted = true;
    setBusy(true);
    read("ajo/proposals/" + proposalId)
      .then((value) => {
        if (!mounted) return;
        setCode(value.invite);
        setBook(value.book);
        setAmount(String(value.dailyKobo / 100));
        setStart(value.startDate);
        setEnd(value.maturityDate);
      })
      .catch((e) => {
        if (mounted) setError(e.message);
      })
      .finally(() => {
        if (mounted) setBusy(false);
      });
    return () => {
      mounted = false;
    };
  }, [proposalId]);
  const dailyKobo = Math.round(Number(amount) * 100),
    fee =
      book?.feePolicy?.kind === "one_day"
        ? dailyKobo
        : book?.feePolicy?.kind === "fixed"
          ? book.feePolicy.amountKobo
          : 0;
  async function preview() {
    if (lock.current) return;
    lock.current = true;
    const revision = ++request.current;
    setBusy(true);
    setError("");
    try {
      const value = await read(
        "ajo/invitation?code=" + encodeURIComponent(code),
      );
      if (revision === request.current) {
        setBook(value);
        setConsent(false);
      }
    } catch (e) {
      if (revision === request.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (lock.current || busy || !book || !consent) return;
        lock.current = true;
        setBusy(true);
        setError("");
        try {
          await submit({
            invite: code,
            dailyKobo,
            startDate: start,
            maturityDate: end,
            termsVersion: book.termsVersion,
            consent: true,
          });
        } catch (e) {
          setError((e as Error).message);
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      <h2>Know your agreement.</h2>
      <p>
        Check who you are saving with before joining. No contribution is taken
        now.
      </p>
      <label>
        Invitation code
        <input
          value={code}
          maxLength={8}
          autoComplete="off"
          required
          disabled={busy}
          onChange={(event) => {
            request.current++;
            setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
            setBook(null);
            setConsent(false);
            setError("");
          }}
        />
      </label>
      {!book && (
        <button
          type="button"
          className="primary"
          disabled={busy || code.length !== 8}
          onClick={() => void preview()}
        >
          {busy ? (
            <LoaderCircle className="spin" />
          ) : (
            <>
              Check invitation
              <ArrowRight size={17} />
            </>
          )}
        </button>
      )}
      {book && (
        <>
          <section className="membership-terms">
            <ShieldCheck size={24} />
            <h3>{book.name}</h3>
            <p>Organized by {book.organizerName}</p>
            <p>{book.rules}</p>
            <strong>{feeDescription(book.feePolicy, dailyKobo)}</strong>
            <p>
              Any fee comes from the first payout, once. Each saver has their
              own contribution and payout date. No return is guaranteed.
            </p>
          </section>
          <label>
            Your daily contribution (₦)
            <input
              type="number"
              inputMode="decimal"
              min="1"
              max="1000000"
              step="0.01"
              required
              disabled={busy}
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setConsent(false);
              }}
            />
          </label>
          <label>
            First contribution date
            <input
              type="date"
              required
              disabled={busy}
              value={start}
              onChange={(event) => {
                setStart(event.target.value);
                setConsent(false);
              }}
            />
          </label>
          <label>
            Agreed payout date
            <input
              type="date"
              min={start}
              required
              disabled={busy}
              value={end}
              onChange={(event) => {
                setEnd(event.target.value);
                setConsent(false);
              }}
            />
          </label>
          {Number.isFinite(fee) && amount && (
            <p>
              Organizer fee for this cycle: <strong>{money(fee)}</strong>. This
              is not charged on every contribution.
            </p>
          )}
          <AgreementCheck checked={consent} onChange={setConsent}>
            I agree to these rules, my contribution dates and the organizer fee
            shown above.
          </AgreementCheck>
          <button className="primary" disabled={busy || !consent}>
            {busy ? (
              <>
                <LoaderCircle className="spin" />
                Joining securely
              </>
            ) : (
              <>
                Agree and join
                <ArrowRight size={17} />
              </>
            )}
          </button>
        </>
      )}
      {error && (
        <div className="error-box" role="alert">
          <span>{error}</span>
        </div>
      )}
    </form>
  );
}
