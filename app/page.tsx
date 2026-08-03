import { ActionCockpit } from "@/app/components/ActionCockpit";
import { dashboardFixture } from "@/app/fixtures/dashboard";

export default function Home() {
  return <ActionCockpit dashboard={dashboardFixture} />;
}
