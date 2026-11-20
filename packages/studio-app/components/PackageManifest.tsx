import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import {
  PACKAGE_LIMITS,
  type PackageEntry,
  type PackageEntryIssue,
  type PickedPackage,
} from '../lib/package-pick';
import { detectLang, type Lang } from '../lib/strings';
import { packageT } from '../lib/strings/package';
import { color, space, type } from '../lib/theme';
import { ActionRow } from './card/ActionRow';
import { Drawer } from './Drawer';
import { PrimaryButton } from './PrimaryButton';
import { TextButton } from './TextButton';

export interface PackageManifestProps {
  readonly open: boolean;
  readonly pkg: PickedPackage | null;
  readonly onClose: () => void;
  /** Called only after confirmation, with checked valid entries only. */
  readonly onConfirm: (selectedEntries: readonly PackageEntry[]) => void;
  readonly confirmLabel?: string;
  readonly testID?: string;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function describeEntryIssue(issue: PackageEntryIssue, lang: Lang = detectLang()): string {
  switch (issue) {
    case 'file-too-large':
      return packageT(lang, 'package.issue.fileTooLarge');
    case 'unsupported-type':
      return packageT(lang, 'package.issue.unsupportedType');
    case 'empty-file':
      return packageT(lang, 'package.issue.emptyFile');
    case 'encrypted-entry':
      return packageT(lang, 'package.issue.encryptedEntry');
    case 'unsupported-compression':
      return packageT(lang, 'package.issue.unsupportedCompression');
    case 'secret-file':
      return packageT(lang, 'package.issue.secretFile');
  }
}

export function computePackageWarning(
  selectedCount: number,
  selectedBytes: number,
  lang: Lang = detectLang(),
): string | null {
  if (selectedCount > PACKAGE_LIMITS.maxFiles) {
    return packageT(lang, 'package.warnTooManyFiles', { max: PACKAGE_LIMITS.maxFiles });
  }
  if (selectedBytes > PACKAGE_LIMITS.maxPackageBytes) {
    return packageT(lang, 'package.warnTooLarge', {
      max: formatBytes(PACKAGE_LIMITS.maxPackageBytes),
    });
  }
  return null;
}

/**
 * Design package manifest confirmation drawer (SS-85 / SS-159 / SS-160).
 */
export function PackageManifest({
  open,
  pkg,
  onClose,
  onConfirm,
  confirmLabel,
  testID = 'package-manifest',
}: PackageManifestProps) {
  const lang = detectLang();
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (!open || !pkg) {
      setSelectedPaths(new Set());
      return;
    }
    const next = new Set<string>();
    for (const entry of pkg.entries) {
      if (!entry.issue) next.add(entry.path);
    }
    setSelectedPaths(next);
  }, [open, pkg]);

  const selectedEntries = useMemo(() => {
    if (!pkg) return [] as readonly PackageEntry[];
    return pkg.entries.filter((entry) => !entry.issue && selectedPaths.has(entry.path));
  }, [pkg, selectedPaths]);

  const selectedBytes = useMemo(
    () => selectedEntries.reduce((sum, entry) => sum + entry.size, 0),
    [selectedEntries],
  );

  const packageWarning = computePackageWarning(selectedEntries.length, selectedBytes, lang);
  const canConfirm = selectedEntries.length > 0 && packageWarning === null;

  const resolvedConfirmLabel = confirmLabel ?? packageT(lang, 'package.confirm');
  const resolvedCancelLabel = packageT(lang, 'package.cancel');
  const resolvedTitle = pkg
    ? packageT(lang, 'package.titleWithName', { name: pkg.name })
    : packageT(lang, 'package.title');

  const togglePath = (entry: PackageEntry) => {
    if (entry.issue) return;
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.add(entry.path);
      }
      return next;
    });
  };

  return (
    <Drawer
      open={open && pkg !== null}
      onClose={onClose}
      title={resolvedTitle}
      initialSnap={0.8}
      testID={testID}
      footer={
        <ActionRow
          negative={<TextButton label={resolvedCancelLabel} onPress={onClose} testID={`${testID}-cancel`} />}
          primary={
            <PrimaryButton
              label={resolvedConfirmLabel}
              onPress={() => onConfirm(selectedEntries)}
              disabled={!canConfirm}
              testID={`${testID}-confirm`}
            />
          }
        />
      }
    >
      {pkg ? (
        <View style={styles.container}>
          <View
            style={[styles.summaryBar, { backgroundColor: color.sunken, borderColor: color.hairline }]}
            testID={`${testID}-summary`}
          >
            <Text style={[styles.summaryText, { color: color.text }]}>
              {packageT(lang, 'package.summary', {
                selected: selectedEntries.length,
                total: pkg.entries.length,
                size: formatBytes(selectedBytes),
              })}
            </Text>
            {packageWarning ? (
              <Text style={[styles.warningText, { color: color.error }]} testID={`${testID}-warning`}>
                {packageWarning}
              </Text>
            ) : null}
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {pkg.entries.map((entry, idx) => {
              const disabled = Boolean(entry.issue);
              const checked = !disabled && selectedPaths.has(entry.path);
              return (
                <Pressable
                  key={entry.path}
                  onPress={() => togglePath(entry)}
                  disabled={disabled}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled }}
                  accessibilityLabel={entry.path}
                  testID={`${testID}-item-${idx}`}
                  style={[
                    styles.row,
                    {
                      borderBottomColor: color.hairline,
                      opacity: disabled ? 0.65 : 1,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.checkbox,
                      {
                        borderColor: checked ? color.primary : color.hairlineStrong,
                        backgroundColor: checked ? color.primary : 'transparent',
                      },
                    ]}
                  >
                    {checked ? <Check size={12} color={color.onPrimary} strokeWidth={2.5} /> : null}
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={[styles.filePath, { color: color.text }]} numberOfLines={1}>
                      {entry.path}
                    </Text>
                    <View style={styles.metaRow}>
                      <Text style={[styles.fileSize, { color: color.text3 }]}>{formatBytes(entry.size)}</Text>
                      {entry.issue ? (
                        <Text
                          style={[styles.issueText, { color: color.text3 }]}
                          testID={`${testID}-issue-${idx}`}
                        >
                          {describeEntryIssue(entry.issue, lang)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </Drawer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  summaryBar: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: space[1],
  },
  summaryText: {
    ...type.callout,
    fontWeight: '600',
  },
  warningText: {
    ...type.caption,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: space[4],
    paddingBottom: space[4],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  filePath: {
    ...type.body,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  fileSize: {
    ...type.caption,
  },
  issueText: {
    ...type.caption,
  },
});
