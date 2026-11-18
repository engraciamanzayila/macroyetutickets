export type PickedDeviceContact = {
  name: string;
  phone: string;
  email: string;
};

type ContactPickerNavigator = Navigator & {
  contacts?: {
    select: (
      properties: Array<"name" | "tel" | "email">,
      options?: { multiple?: boolean },
    ) => Promise<Array<{ name?: string[]; tel?: string[]; email?: string[] }>>;
  };
};

/**
 * Opens the native contact picker where the browser supports the Contact Picker API.
 * The browser itself asks for access after this function is called from a user gesture.
 */
export async function pickDeviceContact(): Promise<PickedDeviceContact | null> {
  if (typeof navigator === "undefined") {
    throw new Error("A seleção de contactos só está disponível no navegador.");
  }

  const picker = (navigator as ContactPickerNavigator).contacts;
  if (!picker?.select) {
    throw new Error(
      "Este navegador ou dispositivo não suporta a seleção direta de contactos. Preencha os dados manualmente.",
    );
  }

  const contacts = await picker.select(["name", "tel", "email"], { multiple: false });
  const contact = contacts[0];
  if (!contact) return null;

  return {
    name: contact.name?.[0]?.trim() ?? "",
    phone: contact.tel?.[0]?.trim() ?? "",
    email: contact.email?.[0]?.trim() ?? "",
  };
}
