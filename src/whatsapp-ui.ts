import { naira } from "./contracts.ts";
import type { Plan } from "./contracts.ts";
import { languages } from "./languages.ts";

const copy = {
  en: {
    recurring: "Recurring savings",
    maximum: "Maximum authorized",
    futureOnly:
      "No one-off debit now. Future runs need the separate recurring consent in your private review.",
    receipt: "Your PayWella receipt is attached.",
    welcome: "Your account is ready. Here are your account details.",
    menu: "What would you like to do? You can also type a request or send a voice note at any time.",
    choose: "Choose service",
    section: "Your money",
    language: "Choose language",
    settings: "Settings",
    settingsBody:
      "Choose your reply language, or open your private settings to change appearance and manage your account.",
    private: "Open privately",
    open: "Open account",
    review: "Review tasks",
    balance: "Available balance",
    held: "Reserved for pending tasks",
    funding: "Your funding details",
    testBank: "These are test account details. Do not send real money to them.",
    services: [
      "Send to a bank",
      "Send to PayWella",
      "Check balance",
      "Fund account",
      "Savings",
      "Ajo",
      "Pay bills",
      "Activity & receipts",
      "Settings",
    ],
    prompts: [
      "Tell me the amount, bank and ten-digit account number. You can send a voice note or a picture of the details.",
      "Tell me the amount and the recipient’s PayWella phone number.",
    ],
    help: [
      "Open your private savings page to create, fund or withdraw from a goal. You can also tell me what you want to save.",
      "Open your private Ajo page to join a book, check contributions or manage your collection records.",
      "Tell me which bill you want to pay, the amount and the phone or meter number. I will check the available products before preparing it.",
      "Your private activity page shows task groups, current payment statuses and downloadable receipts.",
    ],
    ready:
      "Review these tasks together. No money has moved. Check the details, then approve once with your four-digit PIN.",
    current:
      "This is the current status of your task group. Do not submit the same payment again.",
    fees: "Total fees",
    expires: "Review expires",
    taskNames: [
      "Bank transfer",
      "PayWella transfer",
      "Save",
      "Add to savings",
      "Withdraw savings",
      "Bill payment",
      "Ajo contribution",
      "Cash collection record",
      "Fund recorded cash",
      "Ajo payout",
    ],
    unsupported:
      "Please send a text request, a voice note or a clear picture of payment details or an Ajo ledger.",
  },
  pcm: {
    recurring: "Regular savings",
    maximum: "Highest total wey you approve",
    futureOnly:
      "No one-off debit now. Confirm the future savings runs inside your private review.",
    receipt: "Your PayWella receipt dey attached.",
    welcome: "Your account don ready. Na your account details be these.",
    menu: "Wetin you wan do? You fit still type your request or send voice note anytime.",
    choose: "Choose service",
    section: "Your money",
    language: "Choose language",
    settings: "Settings",
    settingsBody:
      "Choose the language we go use reply you, or open your private settings to change how the page look and manage your account.",
    private: "Open privately",
    open: "Open account",
    review: "Check tasks",
    balance: "Money wey you fit use",
    held: "Money wey pending tasks hold",
    funding: "Your funding details",
    testBank: "Na test account details be these. No send real money go there.",
    services: [
      "Send to bank",
      "Send to PayWella",
      "Check balance",
      "Fund account",
      "Savings",
      "Ajo",
      "Pay bills",
      "Activity & receipts",
      "Settings",
    ],
    prompts: [
      "Tell me the amount, bank and the complete ten-digit account number. You fit send voice note or picture of the details.",
      "Tell me the amount and the person’s PayWella phone number.",
    ],
    help: [
      "Open your private savings page to create goal, add money or withdraw. You fit still tell me wetin you wan save.",
      "Open your private Ajo page to join book, check contributions or manage your collection records.",
      "Tell me the bill, amount and phone or meter number. I go check the available products first.",
      "Your private activity page show task groups, payment status and receipts wey you fit download.",
    ],
    ready:
      "Check all these tasks together. No money don move. Check the details, then approve once with your four-digit PIN.",
    current:
      "Na the current status of your task group be this. No send the same payment again.",
    fees: "All fees",
    expires: "Review go expire",
    taskNames: [
      "Bank transfer",
      "PayWella transfer",
      "Save",
      "Add to savings",
      "Withdraw savings",
      "Bill payment",
      "Ajo contribution",
      "Cash collection record",
      "Fund recorded cash",
      "Ajo payout",
    ],
    unsupported:
      "Type your request, send voice note, or send clear picture of payment details or Ajo book.",
  },
  yo: {
    recurring: "Ìfowópamọ́ àtúnṣe",
    maximum: "Àpapọ̀ tó pọ̀ jù tí o fọwọ́ sí",
    futureOnly:
      "A kò yọ owó lẹ́ẹ̀kan báyìí. Jẹ́rìí ìfowópamọ́ ọjọ́ iwájú nínú àyẹ̀wò ìkọ̀kọ̀ rẹ.",
    receipt: "Rísíìtì PayWella rẹ wà níbí.",
    welcome: "Àkọọ́lẹ̀ rẹ ti ṣetán. Èyí ni àlàyé àkọọ́lẹ̀ rẹ.",
    menu: "Kí ni o fẹ́ ṣe? O tún lè kọ ìbéèrè rẹ tàbí fi ohùn ránṣẹ́ nígbàkigbà.",
    choose: "Yan iṣẹ́",
    section: "Owó rẹ",
    language: "Yan èdè",
    settings: "Ètò",
    settingsBody:
      "Yan èdè ìdáhùn rẹ, tàbí ṣí ètò àkọọ́lẹ̀ rẹ ní ìkọ̀kọ̀ láti yí ìrísí rẹ̀ padà.",
    private: "Ṣí ní ìkọ̀kọ̀",
    open: "Ṣí àkọọ́lẹ̀",
    review: "Ṣàyẹ̀wò iṣẹ́",
    balance: "Owó tó wà fún lílò",
    held: "Owó tí iṣẹ́ tó ń dúró dì mú",
    funding: "Àlàyé fífi owó sí àkọọ́lẹ̀",
    testBank: "Àlàyé àkọọ́lẹ̀ ìdánwò ni èyí. Má fi owó gidi ránṣẹ́ sí i.",
    services: [
      "Fi owó sí báńkì",
      "Fi owó sí PayWella",
      "Wo owó tó kù",
      "Fi owó sí àkọọ́lẹ̀",
      "Ìfowópamọ́",
      "Ajo",
      "San owó iṣẹ́",
      "Ìtàn àti rísíìtì",
      "Ètò",
    ],
    prompts: [
      "Sọ iye owó, báńkì àti nọ́mbà àkọọ́lẹ̀ oní nọ́ńbà mẹ́wàá. O lè fi ohùn tàbí àwòrán ránṣẹ́.",
      "Sọ iye owó àti nọ́mbà fóònù PayWella ẹni tí yóò gba owó.",
    ],
    help: [
      "Ṣí ojú ìfowópamọ́ rẹ ní ìkọ̀kọ̀ láti dá ète sílẹ̀, fi owó sí i tàbí yọ owó. O tún lè sọ ohun tí o fẹ́ fi pamọ́.",
      "Ṣí ojú Ajo rẹ ní ìkọ̀kọ̀ láti darapọ̀, wo àfikún tàbí ṣàkóso àkọsílẹ̀ rẹ.",
      "Sọ iṣẹ́ tí o fẹ́ san, iye owó àti nọ́mbà fóònù tàbí mítà. Èmi yóò ṣàyẹ̀wò ohun tó wà.",
      "Ojú ìtàn rẹ fi àkójọpọ̀ iṣẹ́, ipò ìsanwó àti rísíìtì tí o lè gbà hàn.",
    ],
    ready:
      "Ṣàyẹ̀wò gbogbo iṣẹ́ wọ̀nyí papọ̀. Kò sí owó tí ó ti lọ. Jẹ́rìí lẹ́ẹ̀kan pẹ̀lú PIN oní nọ́ńbà mẹ́rin rẹ.",
    current:
      "Èyí ni ipò àkójọpọ̀ iṣẹ́ rẹ. Má fi ìsanwó kan náà ránṣẹ́ lẹ́ẹ̀kan sí i.",
    fees: "Àpapọ̀ owó iṣẹ́",
    expires: "Àkókò ìparí àyẹ̀wò",
    taskNames: [
      "Fífi owó sí báńkì",
      "Fífi owó sí PayWella",
      "Fi owó pamọ́",
      "Fi kún ìfowópamọ́",
      "Yọ owó ìpamọ́",
      "Ìsanwó iṣẹ́",
      "Àfikún Ajo",
      "Àkọsílẹ̀ owó ọwọ́",
      "Rọ́pò owó ọwọ́",
      "Ìsanwó Ajo",
    ],
    unsupported:
      "Kọ ìbéèrè rẹ, fi ohùn ránṣẹ́ tàbí fi àwòrán kedere ti àlàyé ìsanwó tàbí ìwé Ajo ránṣẹ́.",
  },
  ig: {
    recurring: "Nchekwa ego ugboro ugboro",
    maximum: "Ego kacha ị kwadoro",
    futureOnly:
      "A naghị ewepụ ego ozugbo ugbu a. Kwado usoro nchekwa n’ọdịnihu na nyocha nzuzo gị.",
    receipt: "Nnata PayWella gị dị ebe a.",
    welcome: "Akaụntụ gị adịla njikere. Ndị a bụ nkọwa akaụntụ gị.",
    menu: "Gịnị ka ị chọrọ ime? Ị nwekwara ike ide arịrịọ ma ọ bụ zipu ozi olu mgbe ọ bụla.",
    choose: "Họrọ ọrụ",
    section: "Ego gị",
    language: "Họrọ asụsụ",
    settings: "Ntọala",
    settingsBody:
      "Họrọ asụsụ nzaghachi gị, ma ọ bụ mepee ntọala nzuzo gị iji gbanwee ọdịdị na ijikwa akaụntụ.",
    private: "Mepee na nzuzo",
    open: "Mepee akaụntụ",
    review: "Nyochaa ọrụ",
    balance: "Ego ị nwere ike iji",
    held: "Ego ọrụ na-echere jidere",
    funding: "Nkọwa ịtinye ego gị",
    testBank: "Ndị a bụ nkọwa akaụntụ ule. Ezigala ezigbo ego na ya.",
    services: [
      "Ziga ego n'ụlọ akụ",
      "Ziga na PayWella",
      "Lelee ego",
      "Tinye ego",
      "Nchekwa ego",
      "Ajo",
      "Kwụọ ụgwọ",
      "Akụkọ na nnata",
      "Ntọala",
    ],
    prompts: [
      "Gwa m ego, ụlọ akụ na nọmba akaụntụ nwere mkpụrụọnụọgụ iri. Ị nwere ike izipu ozi olu ma ọ bụ foto.",
      "Gwa m ego na nọmba ekwentị PayWella onye ga-anata ya.",
    ],
    help: [
      "Mepee ibe nchekwa nzuzo gị iji mepụta ebumnobi, tinye ego ma ọ bụ wepụ ya. Ị nwekwara ike ịgwa m ihe ị chọrọ ichekwa.",
      "Mepee ibe Ajo nzuzo gị iji sonye, lelee onyinye ma ọ bụ jikwaa ndekọ gị.",
      "Gwa m ụgwọ, ego na nọmba ekwentị ma ọ bụ mita. Aga m elele ngwaahịa dị tupu m kwadebe ya.",
      "Ibe akụkọ nzuzo gị na-egosi otu ọrụ, ọnọdụ ịkwụ ụgwọ na nnata ị nwere ike ibudata.",
    ],
    ready:
      "Nyochaa ọrụ ndị a ọnụ. Ọ dịghị ego ebugharịla. Kwado ha otu ugboro na PIN gị nwere mkpụrụọnụọgụ anọ.",
    current: "Nke a bụ ọnọdụ otu ọrụ gị ugbu a. Ezigala otu ịkwụ ụgwọ ahụ ọzọ.",
    fees: "Ngụkọta ụgwọ ọrụ",
    expires: "Nyocha ga-agwụ",
    taskNames: [
      "Ibufe n'ụlọ akụ",
      "Ibufe PayWella",
      "Chekwaa ego",
      "Tinye na nchekwa",
      "Wepụ nchekwa",
      "Ịkwụ ụgwọ",
      "Onyinye Ajo",
      "Ndekọ ego n'aka",
      "Dochie ego n'aka",
      "Ịkwụ ụgwọ Ajo",
    ],
    unsupported:
      "Dee arịrịọ gị, zipu ozi olu ma ọ bụ foto doro anya nke nkọwa ịkwụ ụgwọ ma ọ bụ akwụkwọ Ajo.",
  },
  ha: {
    recurring: "Ajiya mai maimaituwa",
    maximum: "Mafi yawan kuɗin da ka amince",
    futureOnly:
      "Ba a cire kuɗi lokaci ɗaya yanzu ba. Tabbatar da ajiyar nan gaba a dubawarka ta ɓoye.",
    receipt: "Ga rasit ɗinka na PayWella.",
    welcome: "Asusunka ya shirya. Ga bayanan asusunka.",
    menu: "Me kake son yi? Haka kuma za ka iya rubuta buƙata ko aika saƙon murya a kowane lokaci.",
    choose: "Zaɓi hidima",
    section: "Kuɗinka",
    language: "Zaɓi yare",
    settings: "Saituna",
    settingsBody:
      "Zaɓi yaren amsarka, ko buɗe saitunanka a ɓoye don canza kamanni da sarrafa asusunka.",
    private: "Buɗe a ɓoye",
    open: "Buɗe asusu",
    review: "Duba ayyuka",
    balance: "Kuɗin da za ka iya amfani",
    held: "Kuɗin da ayyukan jira suka riƙe",
    funding: "Bayanan saka kuɗinka",
    testBank:
      "Waɗannan bayanan asusun gwaji ne. Kada ka aika kuɗi na gaske zuwa gare su.",
    services: [
      "Aika zuwa banki",
      "Aika zuwa PayWella",
      "Duba kuɗi",
      "Saka kuɗi",
      "Ajiya",
      "Ajo",
      "Biya kuɗin hidima",
      "Tarihi da rasit",
      "Saituna",
    ],
    prompts: [
      "Faɗa min adadin kuɗi, banki da lambar asusu mai lambobi goma. Za ka iya aika murya ko hoto.",
      "Faɗa min adadin kuɗi da lambar wayar PayWella ta mai karɓa.",
    ],
    help: [
      "Buɗe shafin ajiyarka a ɓoye don ƙirƙira buri, saka ko cire kuɗi. Haka kuma za ka iya gaya min abin da kake son ajiyewa.",
      "Buɗe shafin Ajo naka a ɓoye don shiga, duba gudummawa ko sarrafa bayananka.",
      "Faɗa min hidima, adadin kuɗi da lambar waya ko mita. Zan duba samfuran da ake da su kafin shiryawa.",
      "Shafin tarihinka na ɓoye yana nuna rukunin ayyuka, matsayin biyan kuɗi da rasit da za ka iya saukewa.",
    ],
    ready:
      "Duba waɗannan ayyuka tare. Ba a motsa kuɗi ba. Tabbatar sau ɗaya da PIN ɗinka mai lambobi huɗu.",
    current:
      "Wannan shi ne matsayin rukunin ayyukanka yanzu. Kada ka sake aika biyan kuɗi ɗaya.",
    fees: "Jimillar kuɗin hidima",
    expires: "Lokacin ƙarewar dubawa",
    taskNames: [
      "Tura zuwa banki",
      "Tura PayWella",
      "Ajiye kuɗi",
      "Ƙara ajiya",
      "Cire ajiya",
      "Biyan hidima",
      "Gudummawar Ajo",
      "Rubuta kuɗin hannu",
      "Maye kuɗin hannu",
      "Biyan Ajo",
    ],
    unsupported:
      "Rubuta buƙata, aika murya ko hoto bayyananne na bayanan biyan kuɗi ko littafin Ajo.",
  },
} as const;

export const serviceIds = [
  "bank",
  "p2p",
  "balance",
  "funding",
  "savings",
  "ajo",
  "bills",
  "history",
  "settings",
] as const;
export const controlIds = [
  "menu",
  "settings",
  "account",
  ...serviceIds,
] as const;
export type WhatsAppControl = (typeof controlIds)[number];
export function whatsappCopy(language: string) {
  return copy[language as keyof typeof copy] || copy.en;
}
export function messageControl(
  message: Record<string, any>,
): WhatsAppControl | null {
  if (message.type === "interactive") {
    const id =
      message.interactive?.list_reply?.id ||
      message.interactive?.button_reply?.id;
    return typeof id === "string" &&
      id.startsWith("service:") &&
      controlIds.includes(id.slice(8) as WhatsAppControl)
      ? (id.slice(8) as WhatsAppControl)
      : null;
  }
  if (message.type !== "text") return null;
  const value = String(message.text?.body || "")
    .trim()
    .toLowerCase();
  if (["menu", "main menu", "/menu", "choose service"].includes(value))
    return "menu";
  if (["settings", "/settings"].includes(value)) return "settings";
  return null;
}
type WhatsAppList = {
  type: "list";
  body: { text: string };
  action: {
    button: string;
    sections: { title: string; rows: { id: string; title: string }[] }[];
  };
};
export function serviceMenu(language: string): WhatsAppList {
  const c = whatsappCopy(language);
  return {
    type: "list",
    body: { text: String(c.menu) },
    action: {
      button: c.choose,
      sections: [
        {
          title: c.section,
          rows: serviceIds.map((id, index) => ({
            id: "service:" + id,
            title: c.services[index],
          })),
        },
      ],
    },
  };
}
export function languageMenu(language: string): WhatsAppList {
  const c = whatsappCopy(language);
  return {
    type: "list",
    body: { text: c.settingsBody },
    action: {
      button: c.choose,
      sections: [
        {
          title: c.language,
          rows: languages.map((l) => ({ id: "lang:" + l.id, title: l.name })),
        },
        {
          title: c.settings,
          rows: [{ id: "service:account", title: c.private }],
        },
      ],
    },
  };
}
export function privateAction(text: string, url: string, label: string) {
  if (
    text.length > 1024 ||
    !url.startsWith("https://") ||
    !label ||
    label.length > 20
  )
    return undefined;
  return {
    type: "cta_url",
    body: { text },
    action: { name: "cta_url", parameters: { display_text: label, url } },
  };
}
const taskKinds = [
  "bank_transfer",
  "p2p",
  "goal_create",
  "goal_deposit",
  "goal_withdraw",
  "service",
  "ajo_contribute",
  "ajo_cash",
  "ajo_replace",
  "ajo_payout",
];
export function planMessage(plan: Plan, language: string) {
  const c = whatsappCopy(language),
    ready = plan.status === "READY";
  const tasks = plan.spec.map((task, index) => {
    if (task.savingsSchedule) {
      const schedule = task.savingsSchedule;
      return `${index + 1}. ${c.recurring}: ${naira(schedule.amountKobo)} ${schedule.frequency}\n${schedule.goalName}\n${schedule.startDate} → ${schedule.endDate}, 09:00 WAT\n${c.maximum}: ${naira(schedule.maximumKobo)}\n${c.futureOnly}`;
    }
    const name = c.taskNames[taskKinds.indexOf(task.input.kind)] || task.label;
    const recipient = task.recipient
      ? `${task.recipient.name}\n${task.recipient.bankName} · ${task.recipient.accountNumber}`
      : task.destination || task.label;
    const allocation = task.allocation?.periods;
    return `${index + 1}. ${name}: ${naira(task.amountKobo)}\n${recipient}${allocation?.length ? "\n" + allocation[0].date + " → " + allocation.at(-1)!.date : ""}${ready ? "" : "\n" + (plan.tasks[index]?.status || plan.status)}`;
  });
  return [
    ready ? c.ready : c.current,
    ...tasks,
    `${c.fees}: ${naira(plan.spec.reduce((sum, task) => sum + task.feeKobo, 0))}`,
    ...(ready
      ? [
          `${c.expires}: ${new Date(plan.expiresAt).toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false })} WAT`,
        ]
      : []),
  ].join("\n\n");
}
