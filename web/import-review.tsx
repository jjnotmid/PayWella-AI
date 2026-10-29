import { useState } from "react";
import { ArrowRight, BookOpen, CheckCircle2, AlertCircle } from "lucide-react";
type Item = Record<string, any>;
export function ImportReview({
  candidate,
  members,
  busy,
  onPrepare,
}: {
  candidate: Item;
  members: Item[];
  busy: boolean;
  onPrepare: (tasks: Item[]) => void;
}) {
  const pending = candidate.rows
    .filter((row: Item) => row.status === "PENDING")
    .slice(0, 5);
  const [edits, setEdits] = useState<
    Record<
      string,
      { selected: boolean; memberId: string; amount: string; date: string }
    >
  >({});
  const value = (row: Item) =>
    edits[row.id] || {
      selected: false,
      memberId:
        members.filter(
          (m) => m.name.trim().toLowerCase() === row.name.trim().toLowerCase(),
        ).length === 1
          ? members.find(
              (m) =>
                m.name.trim().toLowerCase() === row.name.trim().toLowerCase(),
            )!.id
          : "",
      amount: row.amountKobo ? String(row.amountKobo / 100) : "",
      date: row.date || "",
    };
  const change = (row: Item, field: string, next: unknown) =>
    setEdits((old) => ({ ...old, [row.id]: { ...value(row), [field]: next } }));
  const selected = pending.filter((row: Item) => value(row).selected),
    valid =
      selected.length > 0 &&
      selected.every((row: Item) => {
        const edit = value(row);
        return (
          edit.memberId &&
          /^\d+(\.\d{1,2})?$/.test(edit.amount) &&
          Number(edit.amount) >= 1 &&
          /^\d{4}-\d{2}-\d{2}$/.test(edit.date) &&
          edit.date <= new Date().toISOString().slice(0, 10)
        );
      });
  return (
    <section className="import-review">
      <header>
        <BookOpen size={23} />
        <div>
          <h3>Check your notebook rows</h3>
          <p>
            Record cash held by the organizer. This does not credit a bank or
            savings balance.
          </p>
        </div>
      </header>
      {!pending.length ? (
        <p className="import-complete">
          <CheckCircle2 size={18} />
          Every row in this picture has been recorded.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || busy) return;
            onPrepare(
              selected.map((row: Item) => {
                const edit = value(row);
                return {
                  kind: "ajo_cash",
                  sourceRow: row.id,
                  memberId: edit.memberId,
                  amountKobo: Math.round(Number(edit.amount) * 100),
                  date: edit.date,
                };
              }),
            );
          }}
        >
          {pending.map((row: Item) => (
            <fieldset key={row.id}>
              <legend>{row.name || "Unreadable name"}</legend>
              {row.unclear && (
                <p className="import-caution">
                  <AlertCircle size={15} />
                  This row needs a closer check.
                </p>
              )}
              <label>
                Member
                <select
                  value={value(row).memberId}
                  required={value(row).selected}
                  onChange={(e) => change(row, "memberId", e.target.value)}
                >
                  <option value="">Choose the matching member</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field-row">
                <label>
                  Cash collected (₦)
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={value(row).amount}
                    onChange={(e) => change(row, "amount", e.target.value)}
                    required={value(row).selected}
                  />
                </label>
                <label>
                  Collection date
                  <input
                    type="date"
                    value={value(row).date}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => change(row, "date", e.target.value)}
                    required={value(row).selected}
                  />
                </label>
              </div>
              <label className="import-select">
                <input
                  type="checkbox"
                  checked={value(row).selected}
                  onChange={(e) => change(row, "selected", e.target.checked)}
                />
                I checked this row and its member.
              </label>
            </fieldset>
          ))}
          {candidate.rows.filter((row: Item) => row.status === "PENDING")
            .length > 5 && (
            <p className="review-note">
              Review up to five rows together. The remaining rows stay here for
              your next review.
            </p>
          )}
          <button className="primary" disabled={busy || !valid}>
            Review {selected.length || ""}{" "}
            {selected.length === 1 ? "row" : "rows"}
            <ArrowRight size={17} />
          </button>
        </form>
      )}
    </section>
  );
}
