import { JSDOM } from "jsdom";

const BLOCK_MARGIN = "margin: 0px 16px";

/** 对齐公众号后台 ProseMirror 默认 HTML 结构 */
export function applyWeChatDefaultHtml(html: string): string {
    const dom = new JSDOM(`<body>${html}</body>`);
    const doc = dom.window.document;
    const wenyan = doc.getElementById("wenyan");
    if (!wenyan) return html;

    const blocks = [...wenyan.children];
    wenyan.replaceChildren();

    for (const block of blocks) {
        const tag = block.tagName;

        if (tag === "HR") {
            wenyan.appendChild(createSpacerParagraph(doc));
            continue;
        }

        if (tag === "BLOCKQUOTE") {
            const paragraphs = block.querySelectorAll("p");
            if (paragraphs.length > 0) {
                for (const p of paragraphs) {
                    wenyan.appendChild(transformParagraph(doc, p));
                    wenyan.appendChild(createSpacerParagraph(doc));
                }
            } else {
                wenyan.appendChild(transformGenericBlock(doc, block));
                wenyan.appendChild(createSpacerParagraph(doc));
            }
            continue;
        }

        wenyan.appendChild(transformGenericBlock(doc, block));
        wenyan.appendChild(createSpacerParagraph(doc));
    }

    normalizeWeChatDefaultStyles(wenyan);

    return wenyan.outerHTML;
}

function createSpacerParagraph(doc: Document): HTMLParagraphElement {
    const p = doc.createElement("p");
    p.setAttribute("style", BLOCK_MARGIN);
    const span = doc.createElement("span");
    span.setAttribute("leaf", "");
    const br = doc.createElement("br");
    br.className = "ProseMirror-trailingBreak";
    span.appendChild(br);
    p.appendChild(span);
    return p;
}

function transformParagraph(doc: Document, source: Element): HTMLParagraphElement {
    const p = doc.createElement("p");
    p.setAttribute("style", BLOCK_MARGIN);
    p.appendChild(wrapWithSpanLeaf(doc, source));
    return p;
}

function transformGenericBlock(doc: Document, source: Element): Element {
    const cloned = source.cloneNode(true) as Element;
    applyBlockMargin(cloned);

    if (cloned.tagName === "P") {
        const p = doc.createElement("p");
        p.setAttribute("style", BLOCK_MARGIN);
        p.appendChild(wrapWithSpanLeaf(doc, cloned));
        return p;
    }

    if (/^H[1-6]$/.test(cloned.tagName)) {
        const inner = cloned.querySelector(":scope > span");
        if (inner) {
            if (!inner.hasAttribute("leaf")) inner.setAttribute("leaf", "");
        } else {
            const span = doc.createElement("span");
            span.setAttribute("leaf", "");
            while (cloned.firstChild) span.appendChild(cloned.firstChild);
            cloned.appendChild(span);
        }
        return cloned;
    }

    return cloned;
}

function wrapWithSpanLeaf(doc: Document, source: Element): HTMLSpanElement {
    const span = doc.createElement("span");
    span.setAttribute("leaf", "");
    while (source.firstChild) span.appendChild(source.firstChild);
    return span;
}

function applyBlockMargin(el: Element): void {
    const tag = el.tagName;
    if (tag === "P" || /^H[1-6]$/.test(tag) || tag === "PRE" || tag === "UL" || tag === "OL" || tag === "BLOCKQUOTE") {
        el.setAttribute("style", BLOCK_MARGIN);
    }
}

/** 去掉 wenyan 注入的字号/字体，只保留公众号默认 margin */
function normalizeWeChatDefaultStyles(wenyan: Element): void {
    wenyan.removeAttribute("style");
    for (const el of wenyan.querySelectorAll("*")) {
        const tag = el.tagName;
        if (tag === "P" || /^H[1-6]$/.test(tag) || tag === "PRE" || tag === "UL" || tag === "OL" || tag === "BLOCKQUOTE") {
            el.setAttribute("style", BLOCK_MARGIN);
        } else if (tag === "IMG") {
            el.setAttribute("style", "display: block; max-width: calc(100% - 32px); height: auto; margin: 0px 16px;");
        } else if (el.hasAttribute("style")) {
            el.removeAttribute("style");
        }
    }
}
