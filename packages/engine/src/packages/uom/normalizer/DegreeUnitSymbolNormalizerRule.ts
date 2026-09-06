import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

/**
 * `°C`, `°F`, `°K` and the precomposed `℃`/`℉` degree-letter signs, retyped
 * to the UNIT spelling the conversion tables already know.
 *
 * The lexer's identifier scan swallows the ASCII letters immediately after a
 * non-ASCII character into the same token (see `ExpressionLexer`'s
 * identifier matching), so `°C` already arrives as one IDENT rather than as
 * `°` and `C` separately; `20°C in F` tokenizes as `NUMBER("20") IDENT("°C")
 * IN(...) UNIT("F")`. What the lexer does not do is recognize that IDENT as a
 * UNIT: `lexer/units.ts` builds its keyword allowlist by filtering the table
 * to `[A-Za-z0-9_]+` spellings, and every spelling here contains a non-ASCII
 * character, so none of them is a lexer keyword. The number then converts
 * fine, but `°C` itself reaches the parser as an undefined variable.
 *
 * `°C` and `°F` are themselves already valid table spellings (see
 * `UnitTable.generated.ts`'s kind-13 temperature record and its
 * `UNIT_DIFFERENCES` offsets), so retyping the token to UNIT is the whole fix
 * for those two, the value carried through is the text as typed. `°K` has no
 * such entry (temperature is not conventionally written with a degree sign
 * before a Kelvin capital), but the request for it is the same request as
 * the other two, so it maps to the bare `K` the table does have. The
 * precomposed signs get the same treatment: `℃` to `C` and `℉` to `F`,
 * equivalently `°C`/`°F`, both name the identical [kind, ratio] entry.
 *
 * Boundary: only these five exact spellings are claimed, compared
 * case-sensitively against the token's own text. `C` and `c` keep meaning
 * what they already mean (Celsius and the cooking cup respectively), and no
 * bare word becomes a keyword, so the unit table's case sensitivity is
 * untouched elsewhere. The bare `°` standing alone is the angle case,
 * handled by {@link degreeSymbolNormalizerRule} in
 * DegreeSymbolNormalizerRule.ts; that rule's shape (`NUMBER` then a
 * single-character `°` IDENT) cannot match this rule's multi-character IDENT
 * text, so the two rules never compete for the same token.
 *
 * Two entry points, not one, and the reason is `implicitMultiplyRule`
 * (`BuiltinNormalizerRules.ts`, priority 50). That rule's own shape starts
 * at the value BEFORE an unrecognized IDENT (`NUMBER`/`RPAREN` then `IDENT`),
 * the same shape `20 x` needs to become `20 * x`. Priority only orders rules
 * that are candidates at the SAME token position, and the normalizer visits
 * positions left to right, so a rule anchored at the IDENT itself (this
 * file's first export) never gets a turn before implicit-multiply has
 * already looked at that NUMBER and inserted a STAR: `37°C` became `37 *
 * °C`, one pass before this rule ever saw position 1. Beating it means
 * anchoring at the SAME position implicit-multiply does, the number or
 * closing paren, which is what {@link degreeUnitSymbolAfterValueNormalizerRule}
 * is for; `DegreeSymbolNormalizerRule.ts` and `UserUnitNormalizerRule.ts`
 * both already carry this exact shape for the same reason.
 *
 * The plain, IDENT-anchored rule stays needed for every position
 * implicit-multiply never touches: the conversion target after `in`/`to`
 * (`20 C in °F`), or the symbol written with nothing before it at all
 * (`°C to F`).
 */
const DEGREE_UNIT_SYMBOLS: ReadonlyMap<string, string> = new Map([
	["°C", "°C"],
	["°F", "°F"],
	["°K", "K"],
	["℃", "C"],
	["℉", "F"],
]);

/** Resolves a source IDENT's text through {@link DEGREE_UNIT_SYMBOLS}, or `undefined` if it names none of them. */
function resolveDegreeUnitSymbol(token: Token): string | undefined {
	return DEGREE_UNIT_SYMBOLS.get(token.value ?? token.text ?? "");
}

/** Builds the retyped UNIT token for `source`, carrying `unit` as its value and the original spelling as its text. */
function buildUnitToken(source: Token, unit: string): Token {
	const fused = new LexerToken(
		"UNIT",
		tokenTypeId("UNIT"),
		unit,
		source.text,
		source.offset,
		source.lineBreaks,
		source.line,
		source.col,
	);
	// Set because value ("K") can differ from the text the reader typed
	// ("°K"), same reasoning as Token.sourceEnd's own doc comment.
	fused.sourceEnd = source.offset + source.text.length;
	return fused;
}

/**
 * Retypes a bare degree-letter IDENT to UNIT wherever it stands: as a
 * conversion target after `in`/`to`, or with nothing before it at all. See
 * this file's own doc comment for why {@link degreeUnitSymbolAfterValueNormalizerRule}
 * exists alongside this one rather than this rule covering everything.
 */
export function degreeUnitSymbolNormalizerRule(priority = 74): NormalizerRule {
	return {
		name: "uom:degree-unit-symbol",
		priority,
		// Derived from this rule's own opening guard; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not. `values` here is
		// only the index's over-approximation (it compares case-insensitively),
		// the exact, case-sensitive check is `match()`'s own map lookup below.
		shape: [{ types: ["IDENT"], values: [...DEGREE_UNIT_SYMBOLS.keys()] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const source = tokens[pos];
			if (source?.type !== "IDENT") return null;

			const unit = resolveDegreeUnitSymbol(source);
			if (unit === undefined) return null;

			return {
				consumed: 1,
				replacement: [buildUnitToken(source, unit)],
				ruleName: "uom:degree-unit-symbol",
			};
		},
	};
}

/**
 * Retypes a degree-letter IDENT immediately after a value (`NUMBER` or
 * `RPAREN`) to UNIT, anchored at the value so it is tried before
 * `implicitMultiplyRule` can insert a spurious `*` ahead of it. See this
 * file's own doc comment.
 */
export function degreeUnitSymbolAfterValueNormalizerRule(priority = 74): NormalizerRule {
	return {
		name: "uom:degree-unit-symbol-after-value",
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [
			{ types: ["NUMBER", "RPAREN"] },
			{ types: ["IDENT"], values: [...DEGREE_UNIT_SYMBOLS.keys()] },
		],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const value = tokens[pos];
			if (value?.type !== "NUMBER" && value?.type !== "RPAREN") return null;

			const source = tokens[pos + 1];
			if (source?.type !== "IDENT") return null;

			const unit = resolveDegreeUnitSymbol(source);
			if (unit === undefined) return null;

			return {
				consumed: 2,
				replacement: [value, buildUnitToken(source, unit)],
				ruleName: "uom:degree-unit-symbol-after-value",
			};
		},
	};
}
