import { useId, useRef, useState } from "react";
import {
  ArrowRight,
  FileCheck2,
  LoaderCircle,
  ShieldCheck,
  UserRound,
  Building2,
  Upload,
} from "lucide-react";
import { AgreementCheck } from "./ajo-join.js";

type Item = Record<string, any>;
function EvidenceUpload({
  name,
  label,
  hint,
  disabled,
}: {
  name: string;
  label: string;
  hint: string;
  disabled: boolean;
}) {
  const id = useId();
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  return (
    <label className="evidence-field">
      <span>{label}</span>
      <span className={"evidence-picker" + (disabled ? " disabled" : "")}>
        <Upload size={21} aria-hidden="true" />
        <span>
          <strong>{filename ? "Change file" : "Choose file"}</strong>
          <span>{filename || "PDF, JPEG or PNG · up to 1 MB"}</span>
        </span>
        <input
          type="file"
          name={name}
          accept="application/pdf,image/jpeg,image/png"
          aria-label={label}
          aria-describedby={id}
          required
          disabled={disabled}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (!file) return;
            if (
              !file.size ||
              file.size > 1048576 ||
              !["application/pdf", "image/jpeg", "image/png"].includes(
                file.type,
              )
            ) {
              event.currentTarget.value = "";
              setFilename("");
              setError("Choose a PDF, JPEG or PNG file smaller than 1 MB.");
              return;
            }
            setFilename(file.name);
            setError("");
          }}
        />
      </span>
      <small id={id}>{hint}</small>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
async function evidence(file: File) {
  if (
    !file.size ||
    file.size > 1048576 ||
    !["application/pdf", "image/jpeg", "image/png"].includes(file.type)
  )
    throw Error("Choose a PDF, JPEG or PNG file smaller than 1 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    name: file.name.slice(0, 100),
    mime: file.type,
    base64: btoa(binary),
  };
}

export function OrganizerApplicationForm({
  submit,
}: {
  submit: (input: Item) => Promise<void>;
}) {
  const [type, setType] = useState("individual"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false);
  const lock = useRef(false);
  return (
    <>
      <div className="card-icon">
        <FileCheck2 size={24} />
      </div>
      <h2>Become an organizer</h2>
      <p className="modal-description">
        Keep contributions, cash records and payouts together. Choose how you
        collect savings.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError("");
          const data = new FormData(event.currentTarget);
          try {
            const addressProof = await evidence(
              data.get("addressProof") as File,
            );
            const registrationProof =
              type === "business"
                ? await evidence(data.get("registrationProof") as File)
                : undefined;
            await submit({
              applicantType: type,
              address: String(data.get("address") || "").trim(),
              addressProof,
              ...(type === "business"
                ? {
                    businessName: String(data.get("businessName") || "").trim(),
                    registrationNumber: String(
                      data.get("registrationNumber") || "",
                    ).trim(),
                    registrationProof,
                  }
                : {}),
              declaration: consent,
            });
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Your application could not be submitted. Check your connection and try again.",
            );
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset className="organizer-kind" disabled={busy}>
          <legend>You collect as</legend>
          {[
            {
              id: "individual",
              title: "An individual",
              text: "No registered business needed",
              Icon: UserRound,
            },
            {
              id: "business",
              title: "A registered business",
              text: "A business registered with CAC",
              Icon: Building2,
            },
          ].map((option) => (
            <label
              key={option.id}
              className={type === option.id ? "selected" : ""}
            >
              <input
                type="radio"
                name="applicantType"
                value={option.id}
                checked={type === option.id}
                onChange={() => setType(option.id)}
              />
              <option.Icon size={20} />
              <span>
                <strong>{option.title}</strong>
                <small>{option.text}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {type === "business" && (
          <>
            <label>
              Registered business name
              <input
                name="businessName"
                autoComplete="organization"
                minLength={2}
                maxLength={150}
                required
                disabled={busy}
              />
            </label>
            <label>
              CAC registration number
              <input
                name="registrationNumber"
                minLength={3}
                maxLength={40}
                required
                disabled={busy}
              />
            </label>
          </>
        )}
        <label>
          {type === "business" ? "Business address" : "Home address"}
          <textarea
            name="address"
            autoComplete="street-address"
            minLength={10}
            maxLength={500}
            rows={3}
            required
            disabled={busy}
          />
        </label>
        <EvidenceUpload
          name="addressProof"
          label="Proof of address"
          hint="A document showing your name and address."
          disabled={busy}
        />
        {type === "business" && (
          <EvidenceUpload
            name="registrationProof"
            label="CAC document"
            hint="Your business registration certificate or status report."
            disabled={busy}
          />
        )}
        <AgreementCheck checked={consent} onChange={setConsent}>
          I confirm these details are correct and agree to their use for
          reviewing my organizer access.
        </AgreementCheck>
        <p className="review-note">
          <ShieldCheck size={16} /> Documents are kept privately for review.
          This application does not open a bank account or approve bank KYC.
        </p>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <button className="primary" disabled={busy || !consent}>
          {busy ? (
            <>
              <LoaderCircle size={18} className="spin" />
              Submitting application
            </>
          ) : (
            <>
              Submit for review
              <ArrowRight size={18} />
            </>
          )}
        </button>
      </form>
    </>
  );
}
