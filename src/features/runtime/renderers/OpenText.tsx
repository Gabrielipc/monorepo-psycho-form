import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { Label } from "../../../app/components/ui/label";
import { Textarea } from "../../../app/components/ui/textarea";
import { cn } from "../../../app/components/ui/utils";
import { validateAnswer, type AnswerRendererProps, type AnswerValue } from "../answer-value";

export const OPEN_TEXT_MAX_LENGTH = 4000;
const OPEN_TEXT_DEBOUNCE_MS = 300;
const WARNING_THRESHOLD_RATIO = 0.9;

type OpenTextValue = Extract<AnswerValue, { kind: "TEXTO_ABIERTO" }>;

function sanitizeOpenText(raw: string): string {
  return raw.replaceAll("\u0000", "").slice(0, OPEN_TEXT_MAX_LENGTH);
}

/**
 * Renderer para ítems de respuesta abierta (`TEXTO_ABIERTO`).
 * Actualiza el texto inmediatamente en la UI, debounced 300 ms hacia el runner,
 * hace flush en `blur` y al desmontar, elimina `'\u0000'`, respeta el límite de 4000
 * caracteres y detiene la propagación de teclas para no disparar atajos del runner.
 */
export function OpenText({ item, value, onChange, disabled = false }: AnswerRendererProps<"TEXTO_ABIERTO">) {
  const textareaId = useId();
  const instructionId = useId();
  const counterId = useId();
  const errorId = useId();

  const [draftText, setDraftText] = useState(value.text);
  const [hasPendingDebounce, setHasPendingDebounce] = useState(false);
  const [syncedProp, setSyncedProp] = useState(() => ({
    itemId: item.id,
    text: value.text,
  }));

  if (item.id !== syncedProp.itemId) {
    setSyncedProp({ itemId: item.id, text: value.text });
    setDraftText(value.text);
    setHasPendingDebounce(false);
  } else if (value.text !== syncedProp.text) {
    setSyncedProp({ itemId: item.id, text: value.text });
    if (!hasPendingDebounce) {
      setDraftText(value.text);
    }
  }

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTextRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const emitText = useCallback((rawText: string) => {
    const nextValue: OpenTextValue = {
      kind: "TEXTO_ABIERTO",
      text: sanitizeOpenText(rawText),
    };
    if (validateAnswer(nextValue) !== null) return;
    onChangeRef.current(nextValue);
  }, []);

  const flushPending = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingTextRef.current;
    if (pending !== null) {
      pendingTextRef.current = null;
      emitText(pending);
    }
  }, [emitText]);

  useEffect(() => {
    return () => {
      flushPending();
    };
  }, [flushPending]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    const sanitized = sanitizeOpenText(event.target.value);
    setDraftText(sanitized);
    setHasPendingDebounce(true);
    pendingTextRef.current = sanitized;

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const pending = pendingTextRef.current;
      pendingTextRef.current = null;
      setHasPendingDebounce(false);
      if (pending !== null) {
        emitText(pending);
      }
    }, OPEN_TEXT_DEBOUNCE_MS);
  };

  const handleBlur = () => {
    setHasPendingDebounce(false);
    flushPending();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
  };

  const labelText = item.prompt && item.prompt.trim().length > 0 ? item.prompt : "Respuesta abierta";
  const instructionText = item.instruction?.trim();
  const validationError = validateAnswer({ kind: "TEXTO_ABIERTO", text: draftText });
  const charCount = draftText.length;
  const isNearLimit = charCount >= OPEN_TEXT_MAX_LENGTH * WARNING_THRESHOLD_RATIO;

  const describedByIds: string[] = [];
  if (instructionText) describedByIds.push(instructionId);
  describedByIds.push(counterId);
  if (validationError !== null) describedByIds.push(errorId);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={textareaId} className="text-sm font-medium text-foreground leading-snug">
        {labelText}
      </Label>

      {instructionText ? (
        <p id={instructionId} className="text-xs text-muted-foreground">
          {instructionText}
        </p>
      ) : null}

      <Textarea
        id={textareaId}
        value={draftText}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        disabled={disabled}
        maxLength={OPEN_TEXT_MAX_LENGTH}
        rows={5}
        placeholder="Escribe tu respuesta aquí..."
        aria-invalid={validationError !== null}
        aria-describedby={describedByIds.join(" ")}
        className="min-h-36 resize-y border-input bg-input-background text-sm sm:text-base leading-relaxed text-foreground focus-visible:ring-[3px] focus-visible:ring-ring aria-invalid:border-status-danger-solid aria-invalid:ring-2 aria-invalid:ring-status-danger-bg"
      />

      <div className="flex items-center justify-between gap-3">
        {validationError !== null ? (
          <p id={errorId} role="alert" className="text-xs text-status-danger-fg">
            {validationError}
          </p>
        ) : (
          <span />
        )}

        <span
          id={counterId}
          aria-live="polite"
          aria-label={`${charCount} de ${OPEN_TEXT_MAX_LENGTH} caracteres`}
          className={cn(
            "font-mono text-xs font-medium tabular-nums",
            isNearLimit ? "text-status-warning-fg" : "text-muted-foreground",
          )}
        >
          {charCount} / {OPEN_TEXT_MAX_LENGTH}
        </span>
      </div>
    </div>
  );
}
