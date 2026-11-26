import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import type { RuntimeItem } from "../../../../api/schemas/runtime";
import { OPEN_TEXT_MAX_LENGTH, OpenText } from "../OpenText";

function makeItem(overrides: Partial<RuntimeItem> = {}): RuntimeItem {
  return {
    id: 101,
    order: 1,
    itemType: "RAZONAMIENTO_VERBAL",
    responseType: "TEXTO_ABIERTO",
    prompt: "Describe el patrón observado en la secuencia.",
    images: [],
    options: [],
    ...overrides,
  };
}

describe("OpenText", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("asocia el label al enunciado, muestra instrucción y contador inicial", () => {
    render(
      <OpenText
        item={makeItem({ instruction: "Sé claro y conciso." })}
        value={{ kind: "TEXTO_ABIERTO", text: "Hola" }}
        onChange={vi.fn()}
      />,
    );

    const textarea = screen.getByLabelText("Describe el patrón observado en la secuencia.");
    expect(textarea).toHaveValue("Hola");
    expect(textarea).toHaveAttribute("maxlength", String(OPEN_TEXT_MAX_LENGTH));
    expect(screen.getByText("Sé claro y conciso.")).toBeInTheDocument();
    expect(screen.getByText(`4 / ${OPEN_TEXT_MAX_LENGTH}`)).toBeInTheDocument();
  });

  it("actualiza el textarea inmediatamente pero aplica debounce de 300 ms a onChange", () => {
    const onChange = vi.fn();

    render(
      <OpenText
        item={makeItem()}
        value={{ kind: "TEXTO_ABIERTO", text: "" }}
        onChange={onChange}
      />,
    );

    const textarea = screen.getByLabelText("Describe el patrón observado en la secuencia.");

    fireEvent.change(textarea, { target: { value: "Prim" } });
    expect(textarea).toHaveValue("Prim");
    expect(screen.getByText(`4 / ${OPEN_TEXT_MAX_LENGTH}`)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: "Primera respuesta" } });
    expect(textarea).toHaveValue("Primera respuesta");
    expect(screen.getByText(`17 / ${OPEN_TEXT_MAX_LENGTH}`)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      kind: "TEXTO_ABIERTO",
      text: "Primera respuesta",
    });
  });

  it("emite el último valor pendiente al hacer blur sin duplicar después del timer", () => {
    const onChange = vi.fn();

    render(
      <OpenText
        item={makeItem()}
        value={{ kind: "TEXTO_ABIERTO", text: "" }}
        onChange={onChange}
      />,
    );

    const textarea = screen.getByLabelText("Describe el patrón observado en la secuencia.");
    fireEvent.change(textarea, { target: { value: "Valor en blur" } });

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(textarea);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      kind: "TEXTO_ABIERTO",
      text: "Valor en blur",
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("emite el último valor pendiente al desmontar (flush) sin duplicar si ya se emitió", () => {
    const onChange = vi.fn();

    const { unmount } = render(
      <OpenText
        item={makeItem()}
        value={{ kind: "TEXTO_ABIERTO", text: "" }}
        onChange={onChange}
      />,
    );

    const textarea = screen.getByLabelText("Describe el patrón observado en la secuencia.");
    fireEvent.change(textarea, { target: { value: "Pendiente al desmontar" } });

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(onChange).not.toHaveBeenCalled();

    unmount();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      kind: "TEXTO_ABIERTO",
      text: "Pendiente al desmontar",
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("no vuelve a emitir al desmontar si el debounce ya había expirado", () => {
    const onChange = vi.fn();

    const { unmount } = render(
      <OpenText
        item={makeItem()}
        value={{ kind: "TEXTO_ABIERTO", text: "" }}
        onChange={onChange}
      />,
    );

    const textarea = screen.getByLabelText("Describe el patrón observado en la secuencia.");
    fireEvent.change(textarea, { target: { value: "Ya guardado" } });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    unmount();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("respeta el límite OPEN_TEXT_MAX_LENGTH (4000), actualiza el contador y conserva espacios", () => {
    expect(OPEN_TEXT_MAX_LENGTH).toBe(4000);
    const onChange = vi.fn();

    render(
      <OpenText
        item={makeItem()}
        value={{ kind: "TEXTO_ABIERTO", text: "" }}
        onChange={onChange}
      />,
    );

    const textarea = screen.getByLabelText("Describe el patrón observado en la secuencia.");
    const oversized = `${"a".repeat(3998)}  extra`;

    fireEvent.change(textarea, { target: { value: oversized } });

    const expected = `${"a".repeat(3998)}  `;
    expect(textarea).toHaveValue(expected);
    expect(screen.getByText(`${OPEN_TEXT_MAX_LENGTH} / ${OPEN_TEXT_MAX_LENGTH}`)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenCalledWith({
      kind: "TEXTO_ABIERTO",
      text: expected,
    });
  });

  it("elimina '\\u0000' del texto antes de actualizar y emitir", () => {
    const onChange = vi.fn();

    render(
      <OpenText
        item={makeItem()}
        value={{ kind: "TEXTO_ABIERTO", text: "" }}
        onChange={onChange}
      />,
    );

    const textarea = screen.getByLabelText("Describe el patrón observado en la secuencia.");
    fireEvent.change(textarea, { target: { value: "Texto\u0000 limpio\u0000!" } });

    expect(textarea).toHaveValue("Texto limpio!");
    expect(screen.getByText(`13 / ${OPEN_TEXT_MAX_LENGTH}`)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenCalledWith({
      kind: "TEXTO_ABIERTO",
      text: "Texto limpio!",
    });
  });

  it("detiene la propagación de teclas (flechas, letras, números) fuera del textarea", () => {
    const parentKeyDown = vi.fn();
    const parentKeyUp = vi.fn();

    render(
      <div onKeyDown={parentKeyDown} onKeyUp={parentKeyUp}>
        <OpenText
          item={makeItem()}
          value={{ kind: "TEXTO_ABIERTO", text: "" }}
          onChange={vi.fn()}
        />
      </div>,
    );

    const textarea = screen.getByLabelText("Describe el patrón observado en la secuencia.");

    for (const key of ["ArrowLeft", "ArrowRight", "a", "A", "1"]) {
      fireEvent.keyDown(textarea, { key });
      fireEvent.keyUp(textarea, { key });
    }

    expect(parentKeyDown).not.toHaveBeenCalled();
    expect(parentKeyUp).not.toHaveBeenCalled();
  });

  it("deshabilita el textarea y no emite cambios cuando disabled es true", () => {
    const onChange = vi.fn();

    render(
      <OpenText
        item={makeItem()}
        value={{ kind: "TEXTO_ABIERTO", text: "Bloqueado" }}
        onChange={onChange}
        disabled
      />,
    );

    const textarea = screen.getByLabelText("Describe el patrón observado en la secuencia.");
    expect(textarea).toBeDisabled();

    fireEvent.change(textarea, { target: { value: "Intento" } });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(textarea).toHaveValue("Bloqueado");
    expect(onChange).not.toHaveBeenCalled();
  });
});
