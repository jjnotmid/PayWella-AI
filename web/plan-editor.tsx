import { useEffect, useState } from "react";
import { ArrowRight, LoaderCircle, Trash2 } from "lucide-react";
type Item = Record<string, any>;
export function PlanEditor({
  plan,
  busy,
  save,
  close,
}: {
  plan: Item;
  busy: boolean;
  save: (tasks: Item[]) => Promise<void>;
  close: () => void;
}) {
  const [tasks, setTasks] = useState<Item[]>(() =>
    plan.spec.map((row: Item) => ({ ...row.input })),
  );
  const [banks, setBanks] = useState<Item[]>(plan.catalogue?.banks || []);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (banks.length) return;
    let active = true;
    fetch("/api/plans/" + plan.id, { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((value) => {
        if (active) setBanks(value.catalogue.banks);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [plan.id, banks.length]);
  const change = (index: number, key: string, value: unknown) =>
    setTasks((old) =>
      old.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
  return (
    <form
      className="plan-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && tasks.length) void save(tasks);
      }}
    >
      <p className="review-note">
        Check your changes together. Saving refreshes the recipient checks and
        replaces the earlier review.
      </p>
      {failed && (
        <p role="alert">
          The bank list could not load. Close this editor and try again before
          changing the bank.
        </p>
      )}
      {tasks.map((task, index) => (
        <fieldset key={index}>
          <legend>Task {index + 1}</legend>
          <label>
            Amount (₦)
            <input
              type="number"
              inputMode="decimal"
              min={task.kind === "goal_create" ? "0" : "1"}
              max="1000000"
              step="0.01"
              value={
                Number.isFinite(task.amountKobo) ? task.amountKobo / 100 : ""
              }
              required
              disabled={busy}
              onChange={(event) =>
                change(
                  index,
                  "amountKobo",
                  event.target.value === ""
                    ? NaN
                    : Math.round(Number(event.target.value) * 100),
                )
              }
            />
          </label>
          {task.kind === "bank_transfer" && (
            <>
              <label>
                Bank
                <select
                  value={task.bankCode}
                  required
                  disabled={busy || !banks.length}
                  onChange={(event) =>
                    change(index, "bankCode", event.target.value)
                  }
                >
                  {banks.length ? (
                    banks.map((bank) => (
                      <option key={bank.code} value={bank.code}>
                        {bank.name}
                      </option>
                    ))
                  ) : (
                    <option value={task.bankCode}>Loading banks…</option>
                  )}
                </select>
              </label>
              <label>
                Account number
                <input
                  inputMode="numeric"
                  pattern="[0-9]{10}"
                  value={task.accountNumber}
                  maxLength={10}
                  required
                  disabled={busy}
                  onChange={(event) =>
                    change(
                      index,
                      "accountNumber",
                      event.target.value.replace(/\D/g, ""),
                    )
                  }
                />
              </label>
            </>
          )}
          {task.kind === "p2p" && (
            <label>
              PayWella phone number
              <input
                inputMode="tel"
                pattern="234[0-9]{10}"
                value={task.recipientPhone}
                required
                disabled={busy}
                onChange={(event) =>
                  change(
                    index,
                    "recipientPhone",
                    event.target.value.replace(/\D/g, ""),
                  )
                }
              />
            </label>
          )}
          {task.kind === "goal_create" && (
            <label>
              Goal name
              <input
                value={task.name}
                maxLength={60}
                required
                disabled={busy}
                onChange={(event) => change(index, "name", event.target.value)}
              />
            </label>
          )}
          {task.kind === "service" && (
            <label>
              Phone or meter number
              <input
                value={task.customer}
                minLength={6}
                maxLength={30}
                required
                disabled={busy}
                onChange={(event) =>
                  change(index, "customer", event.target.value)
                }
              />
            </label>
          )}
          {task.kind === "ajo_cash" && (
            <label>
              Collection date
              <input
                type="date"
                value={task.date}
                max={new Date().toISOString().slice(0, 10)}
                required
                disabled={busy}
                onChange={(event) => change(index, "date", event.target.value)}
              />
            </label>
          )}
          <button
            type="button"
            className="text-button"
            disabled={busy || tasks.length === 1}
            onClick={() => setTasks((old) => old.filter((_, i) => i !== index))}
          >
            <Trash2 size={16} />
            Remove task
          </button>
        </fieldset>
      ))}
      <div className="review-actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={close}
        >
          Keep previous details
        </button>
        <button className="primary" disabled={busy || !tasks.length}>
          {busy ? (
            <>
              <LoaderCircle className="spin" size={18} />
              Checking changes
            </>
          ) : (
            <>
              Save and review
              <ArrowRight size={18} />
            </>
          )}
        </button>
      </div>
    </form>
  );
}
