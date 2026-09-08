import { Redirect } from 'expo-router';

// The single account entry host consumes the original Linking URL in memory.
// Do not forward credentials through navigation parameters or mount a second store.
export default function VerificationCallback() {
  return <Redirect href="/" />;
}
