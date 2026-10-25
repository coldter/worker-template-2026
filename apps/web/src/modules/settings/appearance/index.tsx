import { ContentSection } from "../components/content-section";
import { AppearanceForm } from "./appearance-form";

export const SettingsAppearance = () => (
  <ContentSection
    desc="Customize the appearance of the app. Automatically switch between day
          and night themes."
    title="Appearance"
  >
    <AppearanceForm />
  </ContentSection>
);
