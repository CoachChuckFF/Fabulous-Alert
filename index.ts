import { sleep } from "bun";
import { resolveSoa } from "dns";
import { parse } from "node-html-parser";
import twilio from "twilio";

const DRESS_PATH = Bun.env.DRESS_PATH as string;
const DRESS_SITE = Bun.env.DRESS_SITE as string;

const TWILIO_SID = Bun.env.TWILIO_SID as string;
const TWILIO_AUTH = Bun.env.TWILIO_AUTH as string;
const TWILIO_NUMBER = Bun.env.TWILIO_NUMBER as string;

const SEND_TO_MEL = Bun.env.SEND_TO_MEL as string;
const SEND_TO_JJ = Bun.env.SEND_TO_JJ as string;
const SEND_TO_ME = Bun.env.SEND_TO_ME as string;

const NUMBERS = [SEND_TO_MEL, SEND_TO_JJ, SEND_TO_ME];

interface Dress {
  name: string;
  price: string;
  wasPrice: string;
  productId: string;
  image: string;
  link: string;
  size: string;
  sold: boolean;
  signaled: boolean;
  updated: number;
  created: number;
}

enum Size {
  XS = "(size XS)",
  XS_S = "(size XS-S)",
  S = "(size S)",
  M = "(size M)",
  L = "(size L)",
  XL = "(size XL)",
}

async function sleepRandom(min: number, max: number) {
  const sleepTime = Math.floor(Math.random() * (max - min + 1) + min);
  await sleep(sleepTime);
}

function nameToSize(name: string): string {
  if (name.includes(Size.XS_S)) return Size.XS_S;
  if (name.includes(Size.XS)) return Size.XS;
  if (name.includes(Size.S)) return Size.S;
  if (name.includes(Size.M)) return Size.M;
  if (name.includes(Size.L)) return Size.L;
  if (name.includes(Size.XL)) return Size.XL;
  return "";
}

async function getDressArray(path: string): Promise<Dress[]> {
  const file = Bun.file(path);

  if (!(await file.exists())) {
    return [];
  }

  return [...await file.json()];
}

async function writeDressArray(path: string, dresses: Dress[]) {
  await Bun.write(path, JSON.stringify(dresses));
}

async function fetchSite(url: string, page: number = 1) {
  const pageUrl = url.replace("page=X", `page=${page}`);
  const response = fetch(pageUrl);
  const html = (await response).text();
  return html;
}

async function getPages(url: string): Promise<number> {
  const html = await fetchSite(url);
  const root = parse(html);
  const pageNumbers = root.querySelectorAll(".pagination__number");
  const lastPage = pageNumbers[pageNumbers.length - 1];
  const lastPageNumber = parseInt(lastPage.text);
  return lastPageNumber;
}

async function updateDressPage(page: number) {
  const dresses: Dress[] = await getDressArray(DRESS_PATH);

  const html = await fetchSite(DRESS_SITE, page);
  const root = parse(html);
  const htmlProducts = root.querySelectorAll(".product-block");

  for (const item of htmlProducts) {
    try {
      const productId = item.getAttribute("data-product-id");
      const name = item.querySelector(".product-block__title")?.text;
      const price = item.querySelector(".product-price__amount")?.text;
      const link =
        item.querySelector(".product-link")?.getAttribute("href") ?? "";
      const wasPrice =
        item.querySelector(".product-price__compare")?.text ?? "";
      const image = item.querySelector(".rimage__image");
      const sold = item.querySelector(".price-label--sold-out") !== null;

      if (!link) continue;
      if (!productId) continue;
      if (!name) continue;
      if (!price) continue;
      if (!image) continue;

      const dataSrc = image.getAttribute("data-src");
      const dataWidths = JSON.parse(image.getAttribute("data-widths") ?? "");

      if (!dataSrc || dataSrc.length < 3) continue;
      if (!dataWidths) continue;

      const medianWidth = dataWidths[Math.floor(dataWidths.length / 2)];
      const imageUrl = dataSrc
        .replace("{width}", medianWidth.toString())
        .substring(2);

      const dressIndex = dresses.findIndex(
        (dress) => dress.productId === productId
      );

      if (dressIndex !== -1) {
        const dress = dresses[dressIndex];
        dress.updated = Date.now();
        dress.sold = sold;
      } else {
        dresses.push({
          name,
          price,
          wasPrice,
          link: `https://wearyourlovexo.com${link}`,
          productId: productId,
          image: `https://${imageUrl}`,
          size: nameToSize(name),
          sold: sold,
          updated: Date.now(),
          created: Date.now(),
          signaled: false,
        });
      }
    } catch (error) {
      console.log("Skipping Dress");
    }
  }

  console.log(`Updated Page ${page} with ${htmlProducts.length} dresses`);

  await writeDressArray(DRESS_PATH, dresses);
}

async function updateAllDresses() {
  const pages = await getPages(DRESS_SITE);
  await sleepRandom(1000, 2000);
  console.log(`Found ${pages} pages`);

  for (let page = 1; page < pages + 1; page++) {
    try {
      await updateDressPage(page);
      await sleepRandom(1000, 2000);
    } catch (error) {
      console.log("Skipping Page");
    }
  }
}

async function getDressesToPost() {
  const dresses = [...await getDressArray(DRESS_PATH)];
  const usefulDresses = dresses.map((dress) => {
    if (dress.sold) return null;
    if (dress.signaled) return null;
    if (dress.size === Size.S) return dress;
    if (dress.size === Size.M) return dress;

    return null;
  });

  const filteredDresses = usefulDresses.filter(
    (dress) => dress !== null
  ) as Dress[];
  return filteredDresses.sort((a, b) => a.created - b.created);
}

async function blastUpdate(message: string, numbers: string[] = NUMBERS) {
  const client = new twilio.Twilio(TWILIO_SID, TWILIO_AUTH);

  for (const number of numbers) {
      await client.messages.create({
        body: message,
        from: TWILIO_NUMBER,
        to: number,
      });
      console.log(`Send update to ${number}`);
  }

}

async function updateAll(){

    // UPDATE DRESSES FROM PAGE
    await updateAllDresses();

    // POST NEW UPDATES ABOUT THE DRESSES
    const dresses = await getDressArray(DRESS_PATH);
    const dressesToPost = await getDressesToPost();


    if(dressesToPost.length > 0){
        let message = `👗 FABULOUS ALERT ✨`;

        const dress = dressesToPost[0];
        message += `\n\n${dress.name}\n${dress.price}\n${dress.link}`;

        const dressIndex = dresses.findIndex(
            (dressItem) => dressItem.productId === dress.productId
        );

        if (dressIndex !== -1) {
            dresses[dressIndex].signaled = true;
        }

        await blastUpdate(message, [SEND_TO_ME]);
        await writeDressArray(DRESS_PATH, dresses);
    } else {
        console.log("No new dresses to post");
    }

}

const MIN_DELAY = 1000 * 60 * 1;
const MAX_DELAY = 1000 * 60 * 5;
async function run() {
    while (true) {  // This loop will ensure that your function runs indefinitely
        try {
            console.log("Updating Dresses...");
            await updateAll();
        } catch (error) {
            console.log(error);
        }
        await sleepRandom(MIN_DELAY, MAX_DELAY);
    }
}

run();
