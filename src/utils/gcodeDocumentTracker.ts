export interface GCodeDocumentLike {
  fileName: string;
  languageId: string;
}

interface PreferredGCodeDocumentOptions<T extends GCodeDocumentLike> {
  activeDocument?: T;
  lastDocument?: T;
  visibleDocuments?: readonly T[];
  openDocuments?: readonly T[];
  excludeDocuments?: readonly T[];
  isGCodeDocument: (document: T) => boolean;
}

function buildCandidateList<T extends GCodeDocumentLike>(
  options: PreferredGCodeDocumentOptions<T>
): Array<T | undefined> {
  return [
    options.activeDocument,
    options.lastDocument,
    ...(options.visibleDocuments ?? []),
    ...(options.openDocuments ?? []),
  ];
}

function shouldSkipCandidate<T extends GCodeDocumentLike>(
  candidate: T | undefined,
  seenDocuments: Set<T>,
  excludedDocuments: Set<T>
): candidate is undefined {
  if (!candidate) {
    return true;
  }

  if (seenDocuments.has(candidate)) {
    return true;
  }

  return excludedDocuments.has(candidate);
}

export function selectPreferredGCodeDocument<T extends GCodeDocumentLike>(
  options: PreferredGCodeDocumentOptions<T>
): T | undefined {
  const excludedDocuments = new Set(options.excludeDocuments ?? []);
  const candidates = buildCandidateList(options);
  const seenDocuments = new Set<T>();
  for (const candidate of candidates) {
    if (shouldSkipCandidate(candidate, seenDocuments, excludedDocuments)) {
      continue;
    }

    seenDocuments.add(candidate);
    if (options.isGCodeDocument(candidate)) {
      return candidate;
    }
  }

  return undefined;
}