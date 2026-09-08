import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { currentLegalDocumentVersion } from '../../application/account/kineo-account-session';
import { colors, layout, spacing, typography } from '../theme/tokens';

// Readable prototype notices, not counsel-approved public launch documents.
const documents = [
  { kind: 'terms', title: 'Terms of Service', body:
    'Internal testing only. Kineo is an unfinished wellness prototype for adults aged 18 or older. Use sample data while testing. Exercise content is provisional and is not diagnosis, medical treatment, or clinical advice. Do not use the prototype for urgent symptoms or to replace professional care. Development data may be reset. Public availability remains blocked until content, privacy, security, and legal reviews are complete.' },
  { kind: 'privacy', title: 'Privacy Policy', body:
    'When connected to the backend, Kineo uses Supabase Auth for account credentials and Supabase/PostgreSQL for profile settings, legal acceptance, check-ins, safety responses, routine history, and feedback. Random installation identifiers support synchronization and device ownership. Apple or Google handles its own sign-in when selected; verification and recovery emails use the configured email provider. Data is not end-to-end encrypted. Kineo also keeps a protected local cache for offline history and an active routine. Reset History removes historical wellness data while retaining account preferences and current safety restrictions; Delete Account removes the account and its product data. Export lets you obtain your stored product records. This prototype includes no product analytics or advertising. These are internal-test notices, not final public privacy terms.' },
] as const;

export function PrototypeLegalDocuments() {
  const [expanded, setExpanded] = useState<string>();
  return <View>
    <Text style={styles.caption}>Prototype documents · {currentLegalDocumentVersion}</Text>
    {documents.map((document) => <View key={document.kind}>
      <Pressable accessibilityRole="button"
        accessibilityLabel={`Read prototype ${document.title}`}
        accessibilityState={{ expanded: expanded === document.kind }}
        onPress={() => setExpanded(expanded === document.kind ? undefined : document.kind)}
        style={styles.link}>
        <Text style={styles.linkText}>{document.title} · draft</Text>
      </Pressable>
      {expanded === document.kind ? <Text style={styles.body}>{document.body}</Text> : null}
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  caption: { color: colors.secondaryInk, fontSize: typography.captionSize },
  link: { minHeight: layout.controlMinimumHeight, justifyContent: 'center' },
  linkText: { color: colors.accentDark, fontSize: typography.bodySize, textDecorationLine: 'underline' },
  body: { color: colors.ink, fontSize: typography.detailSize, lineHeight: typography.detailLineHeight, paddingBottom: spacing.standard },
});
