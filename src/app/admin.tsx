import { StyleSheet, Text, View } from 'react-native';

export default function AdminScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>SOS Admin Dashboard</Text>
      <Text style={styles.subtitle}>Monitoring active SOS incidents</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 10,
    fontSize: 16,
  },
});
