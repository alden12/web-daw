import { AppShell } from "./ui/AppShell";
import { AuthGate } from "./ui/AuthGate";

function App() {
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
}

export default App;
