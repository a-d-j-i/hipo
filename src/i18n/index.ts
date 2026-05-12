import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";

export const SUPPORTED_LOCALES = ["es", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_STORAGE_KEY = "hipo.locale";

const forcedLocale = import.meta.env.VITE_LOCALE;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    fallbackLng: "es",
    supportedLngs: SUPPORTED_LOCALES,
    interpolation: { escapeValue: false },
    lng: forcedLocale,
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: LOCALE_STORAGE_KEY,
      // Don't write the forced locale back to localStorage — keeps the dev
      // override transient.
      caches: forcedLocale ? [] : ["localStorage"],
    },
  });

export default i18n;
