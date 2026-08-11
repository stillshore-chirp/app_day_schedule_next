import { useMemo, useState } from "react";
import { translate } from "../i18n/messages";
import { ExternalPreviewLink } from "./ExternalPreviewLink";
import { safeExternalUrl } from "./external-url";

const urlCandidatePattern = /https?:\/\/[^\s<>"'`]+/giu;
const trailingPunctuation = new Set([
  ".",
  ",",
  "!",
  "?",
  ";",
  ":",
  "。",
  "、",
  "，",
  "！",
  "？",
  "；",
  "：",
  "…",
]);
const closingPairs = new Map([
  [")", "("],
  ["]", "["],
  ["}", "{"],
  ["）", "（"],
  ["］", "［"],
  ["｝", "｛"],
  ["】", "【"],
  ["〉", "〈"],
  ["》", "《"],
  ["」", "「"],
  ["』", "『"],
]);

interface PlainTextSegment {
  text: string;
  href?: string;
}

function characterCount(value: string, target: string): number {
  return [...value].filter((character) => character === target).length;
}

function trimUrlCandidate(candidate: string): { linkText: string; trailingText: string } {
  let linkText = candidate;
  let trailingText = "";

  while (linkText) {
    const lastCharacter = [...linkText].at(-1);
    if (!lastCharacter) break;
    if (trailingPunctuation.has(lastCharacter)) {
      linkText = linkText.slice(0, -lastCharacter.length);
      trailingText = `${lastCharacter}${trailingText}`;
      continue;
    }

    const openingCharacter = closingPairs.get(lastCharacter);
    if (
      openingCharacter &&
      characterCount(linkText, lastCharacter) > characterCount(linkText, openingCharacter)
    ) {
      linkText = linkText.slice(0, -lastCharacter.length);
      trailingText = `${lastCharacter}${trailingText}`;
      continue;
    }
    break;
  }

  return { linkText, trailingText };
}

function plainTextSegments(value: string): PlainTextSegment[] {
  const segments: PlainTextSegment[] = [];
  let cursor = 0;

  for (const match of value.matchAll(urlCandidatePattern)) {
    const candidate = match[0];
    const matchIndex = match.index;
    if (matchIndex > cursor) segments.push({ text: value.slice(cursor, matchIndex) });

    const { linkText, trailingText } = trimUrlCandidate(candidate);
    const href = safeExternalUrl(linkText);
    segments.push(href ? { text: linkText, href } : { text: candidate });
    if (href && trailingText) segments.push({ text: trailingText });
    cursor = matchIndex + candidate.length;
  }

  if (cursor < value.length) segments.push({ text: value.slice(cursor) });
  return segments;
}

export function PlainTextPreviewContent({ value }: { value: string }) {
  const [linkOpenFailed, setLinkOpenFailed] = useState(false);
  const segments = useMemo(() => plainTextSegments(value), [value]);

  return (
    <>
      <div className="plain-text-preview__content">
        {segments.map((segment, index) =>
          segment.href ? (
            <ExternalPreviewLink
              href={segment.href}
              key={`${index}-${segment.href}`}
              onOpenFailureChange={setLinkOpenFailed}
            >
              {segment.text}
            </ExternalPreviewLink>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
      </div>
      {linkOpenFailed ? (
        <p className="field-error" role="alert">
          {translate("shared.ui.MarkdownDescriptionField.linkOpenFailed")}
        </p>
      ) : null}
    </>
  );
}
