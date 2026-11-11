import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, space, type } from '../lib/theme';

/** Empty or failed: say what happened and give one way forward. */
export function EmptyState({
  title,
  body,
  action,
  testID = 'empty-state',
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  testID?: string;
}) {
  return (
    <View style={styles.root} testID={testID}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[8],
    paddingHorizontal: space[6],
  },
  title: { ...type.heading, color: color.text, textAlign: 'center' },
  body: { ...type.body, color: color.text2, textAlign: 'center', marginTop: 6 },
  action: { marginTop: space[4] },
});
