// dsh-selection-tools — browser half.
//
// Selection toolbar (shell.overlay): select any non-empty text in the
//     conversation area and a small floating bar appears next to the selection
//     with two actions: attach it as a native input reference or copy it.
//
// Pure client plugin: no host half, no routes, no build step. Styling uses
// only --dsw-* theme tokens, so it follows light/dark mode like the rest of
// the GUI.
window.__ModuleLoader__.load({
	id: "dsh-selection-tools",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let jsxRuntime = require("react/jsx-runtime");
		const { useState, useEffect, useCallback, useRef } = react;
		const { jsx, jsxs, Fragment } = jsxRuntime;

		/** Root client context captured in apply(); used for input-shell access. */
		let rootCtx = null;
		const ANNOTATION_SOURCE = "selection-annotations";
		const MAX_ANNOTATIONS = 50;

		// ---- input-shell access (official conversation service) ---------
		function resolveShell(sessionId) {
			try {
				if (!rootCtx || !sessionId) return undefined;
				const conversation = rootCtx.get("conversation");
				if (!conversation || !conversation.input) return undefined;
				const shell = typeof conversation.input.shell === "function"
					? conversation.input.shell(sessionId)
					: void 0;
				return shell && typeof shell.setDraft === "function" ? shell : undefined;
			} catch {
				return undefined;
			}
		}

		function notifySession(sessionId, level, text) {
			const shell = resolveShell(sessionId);
			if (shell && typeof shell.notify === "function") {
				try {
					shell.notify(level, text);
				} catch {}
			}
		}

		function encodeAnnotations(items) {
			return encodeURIComponent(JSON.stringify(items));
		}

		function decodeAnnotations(ref) {
			try {
				const value = JSON.parse(decodeURIComponent(ref));
				return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
			} catch {
				return [];
			}
		}

		function annotationLabel(count) {
			return `${count} 条注释`;
		}

		function serializeAnnotations(ref) {
			const items = decodeAnnotations(ref);
			if (!items.length) throw new Error("引用内容不可用");
			const body = items.map((text, index) => `<annotation index="${index + 1}">\n${text}\n</annotation>`).join("\n");
			return `<selection_annotations>\n${body}\n</selection_annotations>`;
		}

		/** Add or update the single native reference chip in the current draft. */
		function addAnnotation(sessionId, text) {
			const shell = resolveShell(sessionId);
			if (!shell) {
				notifySession(sessionId, "error", "输入框暂不可用");
				return false;
			}
			const snapshot = shell.snapshot;
			if (!snapshot || !["plain", "claimed"].includes(snapshot.phase)) return false;
			const existing = snapshot.occurrences.find((item) => item.source === ANNOTATION_SOURCE);
			const items = existing ? decodeAnnotations(existing.ref) : [];
			items.push(text);
			if (items.length > MAX_ANNOTATIONS) items.splice(0, items.length - MAX_ANNOTATIONS);
			const label = annotationLabel(items.length);
			const start = existing ? existing.offset : 0;
			const end = existing ? existing.offset + 1 : 0;
			const applied = shell.insertReference({
				source: ANNOTATION_SOURCE,
				ref: encodeAnnotations(items),
				label,
				clipboardText: `[${label}]`
			}, { start, end, draftRev: snapshot.draftRev });
			if (!applied) return false;
			focusComposer();
			return true;
		}

		async function copyText(text) {
			try {
				await navigator.clipboard.writeText(text);
				return true;
			} catch {
				try {
					const textarea = document.createElement("textarea");
					textarea.value = text;
					textarea.style.position = "fixed";
					textarea.style.opacity = "0";
					document.body.appendChild(textarea);
					textarea.select();
					const copied = document.execCommand("copy");
					textarea.remove();
					return copied;
				} catch {
					return false;
				}
			}
		}

		/** Focus the composer textarea if one is visible (best effort). */
		function focusComposer() {
			try {
				const textarea = document.querySelector("textarea:not([readonly]):not([disabled])");
				if (textarea) textarea.focus({ preventScroll: true });
			} catch {}
		}

		// ---- selection utilities ----------------------------------------
		function isEditableTarget(node) {
			const el = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
			if (!el) return false;
			return el.closest("textarea, input:not([type=button]):not([type=submit]), [contenteditable=true]") !== null;
		}

		function isInsidePlugin(node) {
			const el = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
			return !!el && !!el.closest("[data-dsh-selection-tools]");
		}

		/** Current non-empty selection text, or "" when unusable. */
		function currentSelectionText() {
			const sel = window.getSelection && window.getSelection();
			if (!sel || !sel.rangeCount) return "";
			const range = sel.getRangeAt(0);
			if (!range || range.collapsed) return "";
			const text = String(range.toString() || "").trim();
			if (!text) return "";
			// Skip selections that start inside an editable field or our own chrome.
			if (isEditableTarget(sel.anchorNode) || isEditableTarget(sel.focusNode)) return "";
			if (isInsidePlugin(sel.anchorNode) || isInsidePlugin(sel.focusNode)) return "";
			return text;
		}

		/** Selection bounding rect (client coords) or null. */
		function selectionRect() {
			const sel = window.getSelection && window.getSelection();
			if (!sel || !sel.rangeCount) return null;
			const range = sel.getRangeAt(0);
			if (!range || range.collapsed) return null;
			try {
				const rect = range.getBoundingClientRect();
				if (!rect || (rect.width === 0 && rect.height === 0)) return null;
				return rect;
			} catch {
				return null;
			}
		}

		// ---- inline styles ---------------------------------------------
		const toolbar = {
			position: "fixed",
			zIndex: 400,
			pointerEvents: "auto",
			boxSizing: "border-box",
			display: "flex",
			alignItems: "center",
			gap: 4,
			padding: "3px 4px",
			borderRadius: 8,
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "var(--dsw-alias-bg-overlay)",
			boxShadow: "0 4px 14px rgba(0, 0, 0, 0.18)",
			whiteSpace: "nowrap"
		};

		const toolbarButton = {
			display: "inline-flex",
			alignItems: "center",
			gap: 4,
			padding: "2px 8px",
			height: 24,
			border: 0,
			borderRadius: 6,
			background: "transparent",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 12,
			lineHeight: "20px",
			cursor: "pointer"
		};

		const annotationWrap = {
			position: "relative",
			display: "inline-flex",
			alignItems: "center",
			height: 28,
			flex: "0 0 auto"
		};

		const annotationPill = {
			display: "inline-flex",
			alignItems: "center",
			height: 28,
			padding: "0 3px 0 9px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 999,
			background: "var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-overlay))",
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 12,
			lineHeight: "26px",
			whiteSpace: "nowrap",
			boxSizing: "border-box"
		};

		const annotationIcon = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: 15,
			marginRight: 3,
			fontSize: 12,
			color: "var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))"
		};

		const annotationDivider = {
			width: 1,
			height: 14,
			marginLeft: 7,
			background: "var(--dsw-alias-border-l2)"
		};

		const annotationDelete = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: 22,
			height: 22,
			padding: 0,
			border: 0,
			borderRadius: "50%",
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 17,
			lineHeight: 1,
			cursor: "pointer"
		};

		const annotationPopover = {
			position: "absolute",
			left: 0,
			bottom: "calc(100% + 8px)",
			zIndex: 460,
			width: "max-content",
			minWidth: 230,
			maxWidth: "min(380px, calc(100vw - 28px))",
			maxHeight: 260,
			overflowY: "auto",
			padding: "9px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-overlay)",
			boxShadow: "0 8px 24px rgba(0, 0, 0, 0.24)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 12,
			lineHeight: 1.55,
			boxSizing: "border-box"
		};

		const annotationEntry = {
			whiteSpace: "pre-wrap",
			overflowWrap: "anywhere"
		};

		// ---- selection toolbar (shell.overlay) --------------------------
		function SelectionToolbar(props) {
			const useSessions = props.useSessions;
			const sessionId = useSessions((s) => s.current);
			const [pos, setPos] = useState(null); // { left, top, text, sessionId }
			const nodeRef = useRef(null);

			const hide = useCallback(() => setPos(null), []);

			const showForSelection = useCallback(() => {
				const text = currentSelectionText();
				const rect = selectionRect();
				if (!text || !rect) {
					setPos((p) => (p ? null : p));
					return;
				}
				const left = Math.max(8, Math.min(rect.left, window.innerWidth - 210));
				const top = Math.max(6, Math.min(rect.bottom + 6, window.innerHeight - 44));
				setPos({ left, top, text, sessionId });
			}, [sessionId]);

			useEffect(() => {
				const onMouseUp = () => {
					// Defer a tick so the browser resolves the selection first.
					requestAnimationFrame(showForSelection);
				};
				const onKeyUp = (e) => {
					if (e.key === "Shift" || (e.shiftKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))) {
						requestAnimationFrame(showForSelection);
					}
				};
				const onDown = (e) => {
					if (nodeRef.current && nodeRef.current.contains(e.target)) return;
					hide();
				};
				const onScroll = () => hide();
				const onEscape = (e) => {
					if (e.key === "Escape") hide();
				};
				document.addEventListener("mouseup", onMouseUp);
				document.addEventListener("keyup", onKeyUp);
				document.addEventListener("mousedown", onDown, true);
				document.addEventListener("scroll", onScroll, true);
				document.addEventListener("keydown", onEscape);
				return () => {
					document.removeEventListener("mouseup", onMouseUp);
					document.removeEventListener("keyup", onKeyUp);
					document.removeEventListener("mousedown", onDown, true);
					document.removeEventListener("scroll", onScroll, true);
					document.removeEventListener("keydown", onEscape);
				};
			}, [showForSelection, hide]);

			if (!pos) {
				return jsx("span", {
					"data-dsh-selection-tools": "ready",
					"aria-hidden": "true",
					style: { display: "none" }
				});
			}

			const onQuote = () => {
				if (addAnnotation(pos.sessionId, pos.text)) {
					clearSelection();
				}
				hide();
			};

			const onCopy = async () => {
				const copied = await copyText(pos.text);
				notifySession(pos.sessionId, copied ? "info" : "error", copied ? "已复制" : "复制失败");
				clearSelection();
				hide();
			};

			return jsx("div", {
				ref: nodeRef,
				"data-dsh-selection-tools": "toolbar",
				role: "toolbar",
				"aria-label": "选中文字操作",
				style: { ...toolbar, left: pos.left, top: pos.top },
				children: jsxs(Fragment, {
					children: [
						jsx("button", {
							type: "button",
							style: toolbarButton,
							title: "引用到当前输入框",
							onMouseDown: (e) => e.preventDefault(),
							onClick: onQuote,
							children: "引用"
						}),
						jsx("button", {
							type: "button",
							style: toolbarButton,
							title: "复制选中文字",
							onMouseDown: (e) => e.preventDefault(),
							onClick: onCopy,
							children: "复制"
						})
					]
				})
			});
		}

		function clearSelection() {
			try {
				const sel = window.getSelection && window.getSelection();
				if (sel) sel.removeAllRanges();
			} catch {}
		}

		// ---- annotation pill (conversation.input.left) -----------------
		function AnnotationPill(props) {
			const [open, setOpen] = useState(false);
			const input = props.input;
			const inputActions = props.inputActions;
			const occurrences = input && Array.isArray(input.occurrences) ? input.occurrences : [];
			const occurrence = occurrences.find((item) => item.source === ANNOTATION_SOURCE);
			const items = occurrence ? decodeAnnotations(occurrence.ref) : [];

			if (!occurrence || !items.length) return null;

			const removeAll = (event) => {
				event.preventDefault();
				event.stopPropagation();
				setOpen(false);
				if (!inputActions || typeof inputActions.setDraft !== "function") return;
				const draft = typeof input.draft === "string" ? input.draft : "";
				inputActions.setDraft(draft.slice(0, occurrence.offset) + draft.slice(occurrence.offset + 1));
				focusComposer();
			};

			return jsxs(Fragment, {
				children: [
					jsx("style", {
						children: `[data-decoration="chip"][title$="条注释"] { display: none !important; }\n[data-dsh-selection-tools="annotation-pill"] button:hover { background: var(--dsw-alias-bg-hover, rgba(127,127,127,.16)) !important; color: var(--dsw-alias-label-primary) !important; }`
					}),
					jsxs("div", {
						"data-dsh-selection-tools": "annotation-pill",
						style: annotationWrap,
						onMouseEnter: () => setOpen(true),
						onMouseLeave: () => setOpen(false),
						onFocus: () => setOpen(true),
						onBlur: (event) => {
							if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
						},
						children: [
							open && jsx("div", {
								role: "tooltip",
								style: annotationPopover,
								children: items.map((text, index) => jsxs("div", {
									style: {
										...annotationEntry,
										paddingTop: index ? 8 : 0,
										marginTop: index ? 8 : 0,
										borderTop: index ? "1px solid var(--dsw-alias-border-l2)" : "none"
									},
									children: [
										jsx("div", {
											style: { color: "var(--dsw-alias-label-secondary)", marginBottom: 2 },
											children: `${index + 1}、 所选文本：`
										}),
										jsx("div", { children: text })
									]
								}, `${index}:${text.slice(0, 24)}`))
							}),
							jsxs("div", {
								style: annotationPill,
								children: [
									jsx("span", { "aria-hidden": "true", style: annotationIcon, children: "▤" }),
									jsx("span", { children: annotationLabel(items.length) }),
									jsx("span", { "aria-hidden": "true", style: annotationDivider }),
									jsx("button", {
										type: "button",
										"aria-label": "删除全部注释",
										title: "删除全部注释",
										style: annotationDelete,
										onMouseDown: (event) => event.preventDefault(),
										onClick: removeAll,
										children: "×"
									})
								]
							})
						]
					})
				]
			});
		}

		// ---- client plugin body -----------------------------------------
		const inject = ["slots", "inputTriggers"];

		function apply(ctx) {
			rootCtx = ctx;
			const source = {
				trigger: "@",
				name: ANNOTATION_SOURCE,
				order: 1e3,
				candidates: () => Promise.resolve([]),
				onPick: () => void 0,
				codec: {
					clipboardText: (ref) => `[${annotationLabel(decodeAnnotations(ref).length)}]`,
					serialize: (ref) => Promise.resolve(serializeAnnotations(ref))
				}
			};
			const inputTriggers = ctx.get("inputTriggers");
			ctx.effect(() => inputTriggers.registerSource(source), "selection-tools: annotation codec");

			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "selection-tools",
				order: 120,
				label: "选中文字操作"
			}, SelectionToolbar));

			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "selection-annotations",
				order: 180,
				label: "所选文本注释"
			}, AnnotationPill));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
