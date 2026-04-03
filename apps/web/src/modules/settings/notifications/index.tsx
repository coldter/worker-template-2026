import { ContentSection } from "../components/content-section";
import { NotificationsForm } from "./notifications-form";

export function SettingsNotifications() {
  return (
    <ContentSection
      desc="Choose which notifications you receive and how."
      title="Notifications"
    >
      <NotificationsForm />
    </ContentSection>
  );
}
