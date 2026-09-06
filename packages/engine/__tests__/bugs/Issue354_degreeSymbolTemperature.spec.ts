import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

/**
 * Issue #354: `°C`, `°F` and friends read as the units they obviously are.
 *
 * `°C`/`°F` are already valid spellings in the generated unit table (kind 13,
 * temperature), but the lexer can only ever emit a UNIT token for a run of
 * `[A-Za-z0-9_]` (see `lexer/units.ts`), so neither spelling could ever become
 * one: `20°C in F` reached the parser as a number followed by an undefined
 * variable named `°C`, one retyped character away from the word spelling that
 * already worked.
 *
 * `DegreeUnitSymbolNormalizerRule.ts` retypes the IDENT the lexer already
 * hands back for `°C`/`°F`/`°K`/`℃`/`℉` to a UNIT token. Two rules do the
 * retyping: one anchored at the symbol itself (a bare `°C`, or the conversion
 * target after `in`/`to`), and one anchored at the preceding value (a
 * `NUMBER` or `RPAREN`) so it runs before `implicitMultiplyRule` (priority
 * 50, `BuiltinNormalizerRules.ts`) can insert a spurious `*` ahead of the
 * still-unrecognized IDENT — which is exactly what happened before this rule
 * existed: `37°C` normalized to `37 * °C` and failed with "Undefined
 * variable: °C" rather than the plain "37 * <undefined>" a stray letter would
 * have produced, because the STAR insertion ran a whole normalizer pass
 * before the symbol was ever retyped.
 */
describe("Issue #354: degree-symbol temperature units", () => {
	test("°C and °F convert to the word spellings, both directions", () => {
		const engine = newTrackedEngine();
		try {
			expect(engine.evaluateExpression("20°C in F").toNumber()).toBeCloseTo(68, 6);
			expect(engine.evaluateExpression("68°F in C").toNumber()).toBeCloseTo(20, 6);
		} finally {
			engine.clear();
		}
	});

	test("°K reads as kelvin", () => {
		const engine = newTrackedEngine();
		try {
			expect(engine.evaluateExpression("50°K in C").toNumber()).toBeCloseTo(-223.15, 6);
		} finally {
			engine.clear();
		}
	});

	test("the precomposed ℃ and ℉ signs convert the same way", () => {
		const engine = newTrackedEngine();
		try {
			expect(engine.evaluateExpression("37℃ in F").toNumber()).toBeCloseTo(98.6, 6);
			expect(engine.evaluateExpression("100℉ in C").toNumber()).toBeCloseTo(37.77777778, 6);
		} finally {
			engine.clear();
		}
	});

	test("a bare °C quantity is a temperature value, not an undefined variable", () => {
		// This is the case implicitMultiplyRule raced: without the
		// value-anchored rule this normalized to `37 * °C` and threw.
		const engine = newTrackedEngine();
		try {
			const result = engine.evaluateExpression("37°C");
			expect(result.type).toBe(ValueType.Uom);
			expect(result.toNumber()).toBeCloseTo(37, 6);
		} finally {
			engine.clear();
		}
	});

	test("the symbol spelling reaches gas mark exactly like the word spelling", () => {
		const engine = newTrackedEngine();
		try {
			expect(engine.evaluateExpression("180°C in gas mark").toString()).toBe(
				engine.evaluateExpression("180 C in gas mark").toString(),
			);
		} finally {
			engine.clear();
		}
	});

	test("°C as a conversion TARGET (after in/to) also retypes", () => {
		const engine = newTrackedEngine();
		try {
			expect(engine.evaluateExpression("20 C in °F").toNumber()).toBeCloseTo(68, 6);
		} finally {
			engine.clear();
		}
	});

	test("boundary: 90° is still pinned as an angle, not swept into this rule", () => {
		const engine = newTrackedEngine();
		try {
			expect(engine.evaluateExpression("90°").type).toBe(ValueType.Uom);
			expect(engine.evaluateExpression("90° in rad").toNumber()).toBeCloseTo(Math.PI / 2, 9);
			expect(engine.evaluateExpression("sin(90°)").toNumber()).toBeCloseTo(1, 10);
		} finally {
			engine.clear();
		}
	});

	test("boundary: bare C is untouched, still plain Celsius", () => {
		const engine = newTrackedEngine();
		try {
			expect(engine.evaluateExpression("20 C in F").toNumber()).toBeCloseTo(68, 6);
			expect(engine.evaluateExpression("2 cups in mL").toNumber()).toBeCloseTo(473.176473, 4);
		} finally {
			engine.clear();
		}
	});
});
