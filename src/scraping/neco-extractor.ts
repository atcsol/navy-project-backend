import * as cheerio from 'cheerio';
import type { Element, AnyNode } from 'domhandler';

// === Interfaces ===

export interface NecoSubLineItem {
  subLineItem: string;
  quantity?: number;
  unit?: string;
  unitPrice?: string;
  priorityRating?: string;
  internalOrderNumber?: string;
  markFor?: string;
  condition?: string;
  shipTo?: string;
  dodaac?: string;
  cityStateZip?: string;
  productDescription?: string;
  dataCategoryCode?: string;
  dateReferences?: Array<{ type: string; date: string }>;
  preparer?: string;
  authorizer?: string;
}

export interface NecoLineItem {
  lineItem: string;
  nsn?: string;
  nomenclature?: string;
  materialControlCode?: string;
  specialMaterialIdCode?: string;
  shelfLifeCode?: string;
  shelfLifeActionCode?: string;
  vendorCode?: string;
  vendorPartNumber?: string;
  itemDescriptionType?: string;
  itemDescription?: string;
  quantity?: number;
  unit?: string;
  packSize?: number;
  packUnit?: string;
  weight?: string;
  volume?: string;
  dimensions?: string;
  packagingStandard?: string;
  packagingCodes?: Record<string, string>;
  sowText?: string;
  drawingNumbers?: string[];
  documentReferences?: string[];
  cageRefNo?: string;
  subLineItems: NecoSubLineItem[];
}

export interface NecoCdrlItem {
  cdrlItem: string;
  leadTime?: string;
  leadTimeDays?: number;
  agencyQualifier?: string;
  codeListQualifier?: string;
  industryList?: string;
  descriptionType?: string;
  title?: string;
  subtitle?: string;
  referenceNumbers?: string[];
  referenceDetails?: string[];
  clauseReferences?: string[];
  organizationLocations?: string[];
  shipToLocations?: Array<{
    entity: string;
    quantity?: number;
    leadTime?: string;
  }>;
}

export interface NecoExtractedData {
  // === HEADER ===
  solicitationNumber?: string;
  transPurpose?: string;
  issueDate?: string;
  contractType?: string;
  purchaseCategory?: string;
  tdpDrawings?: string;
  documentsUrl?: string;
  synopsisUrl?: string;
  fboDocumentUrl?: string;

  // === DATE/TIME ===
  closingDate?: string;
  closingTime?: string;
  closingTimezone?: string;

  // === REFERENCE NUMBERS ===
  sicCode?: string;
  purchaseRequisitionNo?: string;
  dpasRating?: string;

  // === FOB POINT ===
  fobPoint?: string;
  shipmentPayment?: string;
  acceptancePoint?: string;

  // === SALE CONDITION ===
  setAside?: string;

  // === LEAD TIME ===
  leadTime?: string;
  leadTimeDays?: number;

  // === CONTACT INFORMATION ===
  buyerEntity?: string;
  buyerDodaac?: string;
  buyerAddress?: string;
  buyerCity?: string;
  buyerState?: string;
  buyerZip?: string;
  buyerCountry?: string;

  // === ADMIN COMMUNICATIONS ===
  buyerName?: string;
  buyerEmail?: string;
  buyerPhone?: string;
  buyerFax?: string;
  adminCommunications?: Record<string, string>;

  // === LEGACY flat fields (backward compat) ===
  lineItem?: string;
  nomenclature?: string;
  quantity?: number;
  unit?: string;
  nsn?: string;
  materialControlCode?: string;
  specialMaterialIdCode?: string;
  shelfLifeCode?: string;
  fsc?: string;
  vendorCode?: string;
  vendorPartNumber?: string;
  cageRefNo?: string;
  subLineItems?: Array<{
    subLineItem: string;
    quantity?: number;
    unit?: string;
    shipTo?: string;
    dodaac?: string;
  }>;

  // === LINE ITEMS ARRAY ===
  lineItems: NecoLineItem[];

  // === CDRL ITEMS ===
  cdrlItems?: NecoCdrlItem[];

  // === ITEM CONDITION (from MARK FOR section) ===
  itemCondition?: string; // e.g. "A" (RFI - Ready for Issue)

  // === DOWNLOAD URLs (PDFs from Manual Solicitations) ===
  downloadUrls?: string[];

  // === SOLICITATION TYPE ===
  solicitationType?: 'auto' | 'manual';

  // === METADATA ===
  isAmendment: boolean;
  isCancellation: boolean;
  sectionsFound: string[];
  totalLineItems: number;
  totalSubLineItems: number;
}

// === Section Range Helper ===

interface SectionRange {
  name: string;
  startIndex: number;
  endIndex: number; // exclusive — index of next section header or end of content
}

// === Garbage values for vendor fields ===

const GARBAGE_VENDOR_VALUES = new Set([
  'number', 'and', 'code/reference', 'code', 'ref. no.', 'ref no',
  'vendor', 'seller', 'part', "vendor's", "seller's",
  'cage', 'cage code', 'n/a', 'na', 'none', 'see sow',
]);

function isGarbageVendorValue(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return normalized.length < 2 || GARBAGE_VENDOR_VALUES.has(normalized);
}

// === Known inline labels ===

const KNOWN_LABELS = [
  "Vendor's (Seller's) Part Number",
  'National Stock Number',
  'Nomenclature',
  'Material Control Code',
  'Special Material Identification Code',
  'Shelf-Life Code',
  'Shelf-Life Action Code',
  'Buyer Name or Department',
  'Electronic Mail',
  'Telephone',
  'Facsimile',
  'Department of Defense Activity Address Code',
  'CAGE___Ref. No.',
  'Priority Rating',
  'Purchase Requisition No.',
  'Standard Industry Classification',
  'Small Purchase Set Aside',
  'Transaction Purpose',
  'TDP Drawings',
];

/**
 * Extrator NECO expandido com suporte a múltiplos Line Items, CDRL, SOW, Packaging, etc.
 */
export class NecoExtractor {
  static extract($: cheerio.CheerioAPI): NecoExtractedData {
    const result: NecoExtractedData = {
      isAmendment: false,
      isCancellation: false,
      sectionsFound: [],
      lineItems: [],
      totalLineItems: 0,
      totalSubLineItems: 0,
    };

    // ---------------------------------------------------------------
    // Step 0: Collect all section headers and their DOM positions
    // ---------------------------------------------------------------
    const sectionHeaders: Array<{ name: string; el: Element }> = [];
    $('td.tbl_hdr_lg, .tbl_hdr_lg').each((_, el) => {
      const name = $(el).text().trim();
      if (name) {
        sectionHeaders.push({ name, el });
        result.sectionsFound.push(name);
      }
    });

    // Detect amendment / cancellation
    const pageText = $('body').text();
    if (pageText.includes('Cancellation')) {
      result.isCancellation = true;
      result.isAmendment = true;
    } else if (pageText.includes('Amendment')) {
      result.isAmendment = true;
    }

    // ---------------------------------------------------------------
    // Step 1: Build section ranges using closest <table> boundaries
    // ---------------------------------------------------------------
    // Each section header sits inside a <table>. We use the table element
    // as the content container for that section.
    const sectionTables: Array<{
      name: string;
      table: cheerio.Cheerio<AnyNode>;
    }> = [];

    for (const sh of sectionHeaders) {
      const table = $(sh.el).closest('table');
      if (table.length) {
        sectionTables.push({ name: sh.name, table });
      }
    }

    // ---------------------------------------------------------------
    // Step 2: Categorize sections & process
    // ---------------------------------------------------------------
    const lineItemSections: typeof sectionTables = [];
    const cdrlSections: typeof sectionTables = [];

    for (const sec of sectionTables) {
      const nl = sec.name.toLowerCase();
      // Only match the main "Line Items" header, not sub-sections like
      // "Line Item Product/Item Description", "Line Item Clause References", etc.
      if (nl === 'line items' || (nl.includes('line item') && !nl.includes('sub-line') && !nl.includes('product') && !nl.includes('description') && !nl.includes('packaging') && !nl.includes('marking') && !nl.includes('physical') && !nl.includes('clause') && !nl.includes('reference') && !nl.includes('loading') && !nl.includes('detail'))) {
        lineItemSections.push(sec);
      } else if (
        nl.includes('cdrl') ||
        nl.includes('data requirement') ||
        nl.includes('contract data')
      ) {
        cdrlSections.push(sec);
      }
    }

    // ---------------------------------------------------------------
    // Step 3: Extract GLOBAL header data (from all non-line-item sections)
    // ---------------------------------------------------------------
    this.extractGlobalData($, result);

    // ---------------------------------------------------------------
    // Step 4: Extract Line Items
    // ---------------------------------------------------------------
    if (lineItemSections.length > 0) {
      this.extractLineItems($, result, lineItemSections);
    } else {
      // Fallback: extract single line item from whole page (legacy behavior)
      const singleItem = this.extractSingleLineItemFromPage($);
      if (singleItem) {
        result.lineItems.push(singleItem);
      }
    }

    // ---------------------------------------------------------------
    // Step 5: Extract CDRL Items
    // ---------------------------------------------------------------
    if (cdrlSections.length > 0) {
      result.cdrlItems = this.extractCdrlItems($, cdrlSections);
    }

    // ---------------------------------------------------------------
    // Step 5b: Extract Sub-Line Items (they appear AFTER CDRLs in the HTML)
    // If line items have no sub-line items, try global extraction
    // ---------------------------------------------------------------
    const hasSubItems = result.lineItems.some(li => li.subLineItems.length > 0);
    if (!hasSubItems && result.lineItems.length > 0) {
      const globalSubs = this.extractSubLineItemsGlobal($);
      if (globalSubs.length > 0) {
        // Associate with the first (or only) line item
        result.lineItems[0].subLineItems = globalSubs;
        // If line item has no quantity, sum from sub-items
        if (!result.lineItems[0].quantity || result.lineItems[0].quantity === 0) {
          const totalQty = globalSubs.reduce((sum, s) => sum + (s.quantity || 0), 0);
          if (totalQty > 0) {
            result.lineItems[0].quantity = totalQty;
            const firstUnit = globalSubs.find(s => s.unit);
            if (firstUnit?.unit) result.lineItems[0].unit = firstUnit.unit;
          }
        }
      }
    }

    // ---------------------------------------------------------------
    // Step 6: Validate vendor fields (P2 - fix garbage values)
    // ---------------------------------------------------------------
    this.validateAndFixVendorFields(result);

    // ---------------------------------------------------------------
    // Step 7: Extract item condition from MARK FOR (P4)
    // ---------------------------------------------------------------
    this.extractItemCondition($, result);

    // ---------------------------------------------------------------
    // Step 8: Extract download URLs / detect solicitation type (P5)
    // ---------------------------------------------------------------
    this.extractDownloadUrls($, result);

    // ---------------------------------------------------------------
    // Step 9: Backward compatibility — flatten first line item
    // ---------------------------------------------------------------
    this.flattenFirstLineItem(result);

    // ---------------------------------------------------------------
    // Step 10: Metadata totals
    // ---------------------------------------------------------------
    result.totalLineItems = result.lineItems.length;
    result.totalSubLineItems = result.lineItems.reduce(
      (sum, li) => sum + li.subLineItems.length,
      0,
    );

    return result;
  }

  // =================================================================
  // GLOBAL DATA EXTRACTION
  // =================================================================

  private static extractGlobalData(
    $: cheerio.CheerioAPI,
    result: NecoExtractedData,
  ): void {
    const structuredPairs = this.extractStructuredPairs($);
    const subPairs = this.extractSubPairs($);
    const inlinePairs = this.extractInlinePairs($);

    // --- Trans Purpose ---
    result.transPurpose =
      inlinePairs.get('Transaction Purpose') ||
      structuredPairs.get('Transaction Purpose:') ||
      undefined;

    // --- Contract Type & Purchase Category ---
    result.contractType =
      structuredPairs.get('Contract Type:') ||
      structuredPairs.get('Contract Type') ||
      undefined;
    result.purchaseCategory =
      structuredPairs.get('Purchase Category:') ||
      structuredPairs.get('Purchase Category') ||
      undefined;

    // --- FSC ---
    result.fsc =
      this.findInMap(structuredPairs, 'Federal Supply') || undefined;

    // --- TDP Drawings ---
    result.tdpDrawings =
      inlinePairs.get('TDP Drawings') ||
      structuredPairs.get('TDP Drawings:') ||
      undefined;

    // --- Issue Date ---
    const issueDateRaw =
      structuredPairs.get('Issue Date:') ||
      structuredPairs.get('Issue Date') ||
      undefined;
    if (issueDateRaw) {
      const dateMatch = issueDateRaw.match(/(\w{3}\s+\d{1,2},?\s+\d{4})/);
      result.issueDate = dateMatch ? dateMatch[1] : issueDateRaw;
    }

    // --- Solicitation Number (from page) ---
    const solMatch = pageTextMatch($, /Solicitation\s+(?:Number|#)[:\s]*([A-Z0-9-]+)/i);
    if (solMatch) result.solicitationNumber = solMatch[1];

    // --- Closing Date/Time ---
    for (const [key, value] of inlinePairs) {
      const kl = key.toLowerCase();
      if (kl.includes('received by') || kl.includes('quote to be')) {
        const dateTimeMatch = value.match(
          /(\w+,\s+\w+\s+\d{1,2},?\s+\d{4})\s*([\d:]+\s*[ap]m)?(?:\s+(\w+))?/i,
        );
        if (dateTimeMatch) {
          result.closingDate = dateTimeMatch[1].trim();
          if (dateTimeMatch[2]) result.closingTime = dateTimeMatch[2].trim();
          if (dateTimeMatch[3]) result.closingTimezone = dateTimeMatch[3].trim();
        } else {
          result.closingDate = value;
        }
        break;
      }
    }

    // --- Reference Numbers ---
    for (const [key, value] of inlinePairs) {
      const kl = key.toLowerCase();
      if (kl.includes('purchase requisition')) {
        result.purchaseRequisitionNo = value;
      } else if (kl.includes('dpas') || kl.includes('priority rating')) {
        result.dpasRating = value;
      } else if (kl.includes('sic') && kl.includes('code')) {
        result.sicCode = value;
      }
    }

    // --- Set-Aside ---
    for (const [key, value] of inlinePairs) {
      const kl = key.toLowerCase();
      if (kl.includes('set aside') || kl.includes('unrestricted')) {
        result.setAside = key;
        break;
      }
    }
    if (!result.setAside) {
      for (const [, value] of inlinePairs) {
        if (
          value.toLowerCase().includes('set aside') ||
          value.toLowerCase().includes('unrestricted')
        ) {
          result.setAside = value;
          break;
        }
      }
    }

    // --- FOB Point ---
    this.extractFob($, result, structuredPairs, inlinePairs);

    // --- Lead Time ---
    this.extractLeadTime($, result, inlinePairs);

    // --- Contact / Buyer Information ---
    this.extractBuyerInfo($, result, inlinePairs, structuredPairs);

    // --- Administrative Communications ---
    this.extractAdminComms(result, inlinePairs);

    // --- Documents URLs ---
    this.extractDocumentLinks($, result);
  }

  // =================================================================
  // FOB EXTRACTION
  // =================================================================

  private static extractFob(
    $: cheerio.CheerioAPI,
    result: NecoExtractedData,
    structuredPairs: Map<string, string>,
    inlinePairs: Map<string, string>,
  ): void {
    // Look for FOB section
    $('td.tbl_hdr_lg, .tbl_hdr_lg').each((_, el) => {
      const text = $(el).text().trim();
      if (!text.toLowerCase().includes('fob')) return;

      const parentTable = $(el).closest('table');
      parentTable.find('td.tbl_itm_sm, .tbl_itm_sm').each((_, cell) => {
        const cellText = $(cell).text().trim();
        if (!cellText) return;
        const cl = cellText.toLowerCase();

        if (
          cl.includes('origin') ||
          cl.includes('destination') ||
          cl.includes('shipping point')
        ) {
          if (!result.fobPoint) result.fobPoint = cellText;
        }
        if (cl.includes('paid by')) {
          result.shipmentPayment = cellText;
        }
        if (cl.includes('acceptance')) {
          result.acceptancePoint = cellText;
        }
      });
    });

    // Fallback from structured pairs
    if (!result.fobPoint) {
      const fob =
        structuredPairs.get('FOB Point:') ||
        structuredPairs.get('FOB Point') ||
        this.findInMap(structuredPairs, 'FOB');
      if (fob) result.fobPoint = fob;
    }
  }

  // =================================================================
  // BUYER INFO EXTRACTION
  // =================================================================

  private static extractBuyerInfo(
    $: cheerio.CheerioAPI,
    result: NecoExtractedData,
    inlinePairs: Map<string, string>,
    structuredPairs: Map<string, string>,
  ): void {
    // Look for Trading Partner / Contact section
    $('td.tbl_hdr_lg, .tbl_hdr_lg').each((_, el) => {
      const text = $(el).text().trim().toLowerCase();
      if (
        !text.includes('trading partner') &&
        !text.includes('contact') &&
        !text.includes('buyer')
      )
        return;

      const parentTable = $(el).closest('table');
      const cells = parentTable.find('td.tbl_itm_sm, .tbl_itm_sm');
      const texts: string[] = [];
      cells.each((_, cell) => {
        const t = $(cell).text().trim();
        if (t) texts.push(t);
      });

      // Parse entity name and DODAAC from structured fields in the section
      parentTable.find('td.tbl_hdr, .tbl_hdr').each((_, hdr) => {
        const key = $(hdr).text().trim();
        const valCell = $(hdr).next('td.tbl_itm_sm, .tbl_itm_sm, td.tbl_itm, .tbl_itm');
        if (!valCell.length) return;
        const val = valCell.text().trim();

        if (key.includes('Entity') && val.includes('Buyer')) {
          // Extract entity name from the value or next cell
          const nameCell = valCell.next('td.tbl_itm_sm, .tbl_itm_sm');
          if (nameCell.length) {
            result.buyerEntity = nameCell.text().trim();
          }
        }
        if (key.includes('DoD') && val.includes('DODAAC')) {
          const dodMatch = val.match(/DODAAC\)?\s*(\S+)/);
          if (dodMatch) result.buyerDodaac = dodMatch[1];
        }
      });

      // Try to extract address from inline text blocks
      for (const t of texts) {
        // Pattern: City, ST ZIP or City, ST  ZIP-XXXX
        const addrMatch = t.match(
          /^([A-Z][A-Z\s]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)(?:\s+(.+))?$/,
        );
        if (addrMatch) {
          result.buyerCity = addrMatch[1].trim();
          result.buyerState = addrMatch[2];
          result.buyerZip = addrMatch[3];
          if (addrMatch[4]) result.buyerCountry = addrMatch[4].trim();
        }
      }
    });

    // DODAAC fallback
    if (!result.buyerDodaac) {
      const dodaac = inlinePairs.get(
        'Department of Defense Activity Address Code',
      );
      if (dodaac) {
        const match = dodaac.match(/([A-Z0-9]{6})/);
        if (match) result.buyerDodaac = match[1];
      }
    }
  }

  // =================================================================
  // ADMIN COMMUNICATIONS
  // =================================================================

  private static extractAdminComms(
    result: NecoExtractedData,
    inlinePairs: Map<string, string>,
  ): void {
    const adminComm: Record<string, string> = {};

    for (const [key, value] of inlinePairs) {
      const kl = key.toLowerCase();
      if (kl.includes('buyer name') || kl.includes('buyer dept')) {
        if (!result.buyerName) result.buyerName = value;
        adminComm['Buyer Name'] = value;
      } else if (
        kl.includes('electronic mail') ||
        kl.includes('e-mail') ||
        (kl.includes('email') && !kl.includes('system'))
      ) {
        if (!result.buyerEmail) result.buyerEmail = value;
        adminComm['Email'] = value;
      } else if (kl.includes('telephone') || kl.includes('phone')) {
        if (!result.buyerPhone) result.buyerPhone = value;
        adminComm['Telephone'] = value;
      } else if (kl.includes('facsimile') || kl.includes('fax')) {
        if (!result.buyerFax) result.buyerFax = value;
        adminComm['Fax'] = value;
      }
    }

    if (Object.keys(adminComm).length > 0) {
      result.adminCommunications = adminComm;
    }
  }

  // =================================================================
  // P2: VALIDATE AND FIX VENDOR FIELDS (garbage detection + SOW fallback)
  // =================================================================

  private static validateAndFixVendorFields(result: NecoExtractedData): void {
    for (const lineItem of result.lineItems) {
      const vendorCodeBad = isGarbageVendorValue(lineItem.vendorCode);
      const vendorPartBad = isGarbageVendorValue(lineItem.vendorPartNumber);

      if (vendorCodeBad || vendorPartBad) {
        // Try extracting from SOW text: pattern ";CAGE    PartNumber;"
        const sowExtracted = this.extractCageFromSow(lineItem.sowText);
        if (sowExtracted) {
          if (vendorCodeBad) lineItem.vendorCode = sowExtracted.cage;
          if (vendorPartBad) lineItem.vendorPartNumber = sowExtracted.partNumber;
          if (!lineItem.cageRefNo) lineItem.cageRefNo = `${sowExtracted.cage} ${sowExtracted.partNumber}`;
        } else {
          // Clear garbage values
          if (vendorCodeBad) lineItem.vendorCode = undefined;
          if (vendorPartBad) lineItem.vendorPartNumber = undefined;
        }
      }
    }
  }

  private static extractCageFromSow(sowText?: string): { cage: string; partNumber: string } | null {
    if (!sowText) return null;

    // Pattern 1: ";CAGE    PartNumber;" (semicolon-delimited)
    const semiMatch = sowText.match(/;(\w{4,5})\s+(\S+);/);
    if (semiMatch) {
      return { cage: semiMatch[1], partNumber: semiMatch[2] };
    }

    // Pattern 2: "CAGE___Ref. No." followed by the actual values
    const cageRefMatch = sowText.match(/CAGE[_\s]*(?:Ref\.?\s*No\.?)?[:\s]*;?\s*(\w{4,5})\s+(\S+)/i);
    if (cageRefMatch) {
      return { cage: cageRefMatch[1].replace(/[;]/g, ''), partNumber: cageRefMatch[2].replace(/[;]/g, '') };
    }

    // Pattern 3: "CAGE: XXXXX" and "P/N: YYYYY" separately
    const cageOnly = sowText.match(/CAGE[:\s]+(\w{4,5})/i);
    const pnOnly = sowText.match(/(?:P\/N|Part\s*(?:No|Number|#))[:\s]+(\S+)/i);
    if (cageOnly && pnOnly) {
      return { cage: cageOnly[1], partNumber: pnOnly[1] };
    }

    return null;
  }

  // =================================================================
  // P4: EXTRACT ITEM CONDITION FROM MARK FOR
  // =================================================================

  private static extractItemCondition(
    $: cheerio.CheerioAPI,
    result: NecoExtractedData,
  ): void {
    const bodyText = $('body').text();

    // Pattern: "'A' CONDITION STOCK" or "CONDITION 'A'"
    const condMatch = bodyText.match(/'([A-Z])'\s*CONDITION\s*STOCK/i) ||
                      bodyText.match(/CONDITION\s+'([A-Z])'/i) ||
                      bodyText.match(/MARK\s+FOR[:\s]*[^]*?'([A-Z])'\s*CONDITION/i);
    if (condMatch) {
      result.itemCondition = condMatch[1];
    }

    // Also assign to sub-line items that have MARK FOR data
    for (const lineItem of result.lineItems) {
      for (const sub of lineItem.subLineItems) {
        if (sub.markFor && !sub.condition) {
          const subCondMatch = sub.markFor.match(/'([A-Z])'\s*CONDITION/i);
          if (subCondMatch) {
            sub.condition = subCondMatch[1];
          } else if (result.itemCondition) {
            // Inherit from parent if not explicitly set
            sub.condition = result.itemCondition;
          }
        }
      }
    }
  }

  // =================================================================
  // P5: EXTRACT DOWNLOAD URLs (PDFs from Manual Solicitations)
  // =================================================================

  private static extractDownloadUrls(
    $: cheerio.CheerioAPI,
    result: NecoExtractedData,
  ): void {
    const downloadUrls: string[] = [];

    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      // Match PDF links and other document downloads
      if (href.match(/\.(pdf|doc|docx|xls|xlsx|zip)$/i) ||
          href.includes('/upload/') ||
          href.includes('/attachment')) {
        // Normalize URL
        const fullUrl = href.startsWith('http') ? href :
          href.startsWith('/') ? `https://neco.navy.mil${href}` : href;
        if (!downloadUrls.includes(fullUrl)) {
          downloadUrls.push(fullUrl);
        }
      }
    });

    if (downloadUrls.length > 0) {
      result.downloadUrls = downloadUrls;
    }

    // Detect solicitation type: Manual has PDFs and fewer structured fields
    const hasRichStructure = result.lineItems.length > 0 &&
      result.lineItems.some(li => li.nsn || li.vendorCode);
    result.solicitationType = hasRichStructure ? 'auto' : 'manual';
  }

  // =================================================================
  // DOCUMENT LINKS
  // =================================================================

  private static extractDocumentLinks(
    $: cheerio.CheerioAPI,
    result: NecoExtractedData,
  ): void {
    $('a').each((_, el) => {
      const text = $(el).text().trim().toLowerCase();
      const href = $(el).attr('href');
      if (!href) return;

      if (text.includes('additional document')) {
        result.documentsUrl = href;
      } else if (text.includes('view synopsis') || text.includes('synopsis')) {
        result.synopsisUrl = href;
      } else if (text.includes('fbo') || text.includes('fedbizopps')) {
        result.fboDocumentUrl = href;
      }
    });
  }

  // =================================================================
  // LINE ITEMS EXTRACTION (multiple)
  // =================================================================

  private static extractLineItems(
    $: cheerio.CheerioAPI,
    result: NecoExtractedData,
    lineItemSections: Array<{
      name: string;
      table: cheerio.Cheerio<AnyNode>;
    }>,
  ): void {
    // Each "Line Items" section header is followed by content.
    // We need to find all content between consecutive tbl_hdr_lg sections.
    // Strategy: walk through all tables in document order and group them
    // under the correct line item header.

    // Get all tbl_hdr_lg elements in document order
    const allHeaders = $('td.tbl_hdr_lg, .tbl_hdr_lg').toArray();

    for (let i = 0; i < allHeaders.length; i++) {
      const headerText = $(allHeaders[i]).text().trim();
      const hl = headerText.toLowerCase();
      // Only process main "Line Items" headers, not sub-sections like
      // "Line Item Product/Item Description"
      if (!this.isMainLineItemHeader(hl)) continue;

      // Collect all content tables between this header and the next main "Line Items" or CDRL
      const currentHeaderTable = $(allHeaders[i]).closest('table');
      const contentTables: cheerio.Cheerio<AnyNode>[] = [
        currentHeaderTable,
      ];

      // Walk sibling tables until next main Line Item header or CDRL or end
      let nextEl = currentHeaderTable.next();
      while (nextEl.length) {
        // Check if this element contains a tbl_hdr_lg
        const nestedHeader = nextEl.find('td.tbl_hdr_lg, .tbl_hdr_lg');
        if (nestedHeader.length) {
          const nextHeaderText = nestedHeader.first().text().trim().toLowerCase();
          // Stop only if we hit another MAIN "Line Items" header or CDRL
          if (this.isMainLineItemHeader(nextHeaderText)) {
            break;
          }
          if (
            nextHeaderText.includes('cdrl') ||
            nextHeaderText.includes('data requirement') ||
            nextHeaderText.includes('contract data')
          ) {
            break;
          }
        }
        contentTables.push(nextEl as cheerio.Cheerio<AnyNode>);
        nextEl = nextEl.next();
      }

      // Create a virtual context from all content tables
      const lineItem = this.parseLineItemFromTables($, contentTables);
      if (lineItem) {
        result.lineItems.push(lineItem);
      }
    }

    // If no line items found via section walking, try the flat approach
    if (result.lineItems.length === 0) {
      const fallback = this.extractSingleLineItemFromPage($);
      if (fallback) {
        result.lineItems.push(fallback);
      }
    }
  }

  // =================================================================
  // HELPER: Check if a header is a MAIN "Line Items" section
  // (not a sub-section like "Line Item Product/Item Description")
  // =================================================================

  private static isMainLineItemHeader(headerLower: string): boolean {
    // Must contain "line item" but NOT be a sub-section
    if (!headerLower.includes('line item')) return false;
    if (headerLower.includes('sub-line')) return false;
    // Sub-sections to exclude
    const subSectionKeywords = [
      'product', 'description', 'packaging', 'marking',
      'physical', 'clause', 'reference', 'loading', 'detail',
    ];
    for (const kw of subSectionKeywords) {
      if (headerLower.includes(kw)) return false;
    }
    return true;
  }

  // =================================================================
  // PARSE A SINGLE LINE ITEM FROM TABLE COLLECTION
  // =================================================================

  private static parseLineItemFromTables(
    $: cheerio.CheerioAPI,
    tables: cheerio.Cheerio<AnyNode>[],
  ): NecoLineItem | null {
    const lineItem: NecoLineItem = {
      lineItem: '',
      subLineItems: [],
    };

    // Combine all HTML from tables for scoped extraction
    const pairs = new Map<string, string>();
    const inlinePairs = new Map<string, string>();
    const subItems: NecoSubLineItem[] = [];
    let currentSubItem: NecoSubLineItem | null = null;
    let inSubLineSection = false;

    for (const table of tables) {
      // Check if this table starts a sub-line item section
      const sectionHeader = table.find('td.tbl_hdr_lg, .tbl_hdr_lg');
      if (sectionHeader.length) {
        const hdrText = sectionHeader.text().trim().toLowerCase();
        if (hdrText.includes('sub-line')) {
          inSubLineSection = true;
        } else if (hdrText.includes('product') || hdrText.includes('item description')) {
          // Product/Item Description section - might be for line item or sub-line item
        } else if (hdrText.includes('packaging')) {
          this.parsePackagingFromTable($, table, lineItem);
          continue;
        } else if (hdrText.includes('physical')) {
          this.parsePhysicalDetailsFromTable($, table, lineItem);
          continue;
        } else if (
          hdrText.includes('clause') ||
          hdrText.includes('sow') ||
          hdrText.includes('statement of work')
        ) {
          this.parseSowFromTable($, table, lineItem);
          continue;
        }
      }

      // Process key-value pairs
      table.find('td.tbl_hdr, .tbl_hdr').each((_, el) => {
        const key = $(el).text().trim();
        if (!key) return;

        // Check for tbl_itm_sm (sub-level pairs)
        const nextSmall = $(el).next('td.tbl_itm_sm, .tbl_itm_sm');
        // Check for tbl_itm (top-level pairs)
        const nextItem = $(el).next('td.tbl_itm, .tbl_itm');

        const value = nextSmall.length
          ? nextSmall.text().trim()
          : nextItem.length
            ? nextItem.text().trim()
            : '';

        if (!value) return;

        // Sub-Line Item detection
        if (key === 'Sub-Line Item:' || key === 'Sub-Line Item') {
          if (currentSubItem) subItems.push(currentSubItem);
          currentSubItem = { subLineItem: value };
          inSubLineSection = true;
          return;
        }

        // Line Item number
        if (key === 'Line Item:' || key === 'Line Item') {
          lineItem.lineItem = value;
          return;
        }

        // If we're in a sub-line context, assign to sub-line item
        if (inSubLineSection && currentSubItem) {
          this.assignSubLineField(currentSubItem, key, value);
        }

        pairs.set(key, value);
      });

      // Extract inline data from tbl_itm_sm
      table.find('td.tbl_itm_sm, .tbl_itm_sm').each((_, el) => {
        const raw = $(el).text().trim();
        if (!raw || raw.length < 3) return;
        this.parseInlineText(raw, inlinePairs);
      });
    }

    // Push last sub-item
    if (currentSubItem) subItems.push(currentSubItem);

    // If no line item number found, skip
    if (!lineItem.lineItem && !inlinePairs.has('National Stock Number')) {
      // Try to get line item from pairs
      const liNum = pairs.get('Line Item:') || pairs.get('Line Item');
      if (liNum) {
        lineItem.lineItem = liNum;
      } else {
        return null;
      }
    }

    // Map extracted data to lineItem fields
    lineItem.nsn = inlinePairs.get('National Stock Number') || undefined;
    lineItem.nomenclature =
      inlinePairs.get('Nomenclature') ||
      pairs.get('General Desc:') ||
      pairs.get('General Desc') ||
      undefined;
    lineItem.materialControlCode =
      inlinePairs.get('Material Control Code') || undefined;
    lineItem.specialMaterialIdCode =
      inlinePairs.get('Special Material Identification Code') || undefined;
    lineItem.shelfLifeCode = inlinePairs.get('Shelf-Life Code') || undefined;
    lineItem.shelfLifeActionCode =
      inlinePairs.get('Shelf-Life Action Code') || undefined;

    // Vendor info
    const vendorRaw = inlinePairs.get("Vendor's (Seller's) Part Number");
    if (vendorRaw) {
      const parts = vendorRaw.trim().split(/\s+/);
      if (parts.length >= 2) {
        lineItem.vendorCode = parts[0];
        lineItem.vendorPartNumber = parts.slice(1).join(' ');
      } else if (parts.length === 1) {
        lineItem.vendorCode = parts[0];
      }
    }

    // CAGE from SOW fallback
    if (!lineItem.vendorCode) {
      const cageRef = inlinePairs.get('CAGE___Ref. No.');
      if (cageRef) {
        const cleaned = cageRef.replace(/[;]/g, '').trim();
        const parts = cleaned.split(/\s+/);
        if (parts.length >= 2) {
          lineItem.vendorCode = parts[0];
          lineItem.vendorPartNumber = parts.slice(1).join(' ');
        }
        lineItem.cageRefNo = cleaned;
      }
    }

    // Quantity
    const qtyRaw = pairs.get('Quantity:') || pairs.get('Quantity');
    if (qtyRaw) {
      const parsed = this.parseQuantityValue(qtyRaw);
      if (parsed) {
        lineItem.quantity = parsed.quantity;
        lineItem.unit = parsed.unit;
      }
    }

    // Sub-line items
    lineItem.subLineItems = subItems;

    // If quantity is 0 or missing, sum from sub-line items
    if (!lineItem.quantity || lineItem.quantity === 0) {
      const totalQty = subItems.reduce(
        (sum, s) => sum + (s.quantity || 0),
        0,
      );
      if (totalQty > 0) {
        lineItem.quantity = totalQty;
        lineItem.unit = subItems[0]?.unit;
      }
    }

    return lineItem;
  }

  // =================================================================
  // SUB-LINE ITEM FIELD ASSIGNMENT
  // =================================================================

  private static assignSubLineField(
    subItem: NecoSubLineItem,
    key: string,
    value: string,
  ): void {
    const kn = key.replace(/:$/, '');

    if (kn === 'Quantity') {
      const parsed = this.parseQuantityValue(value);
      if (parsed) {
        subItem.quantity = parsed.quantity;
        subItem.unit = parsed.unit;
      }
    } else if (kn === 'Unit Price' || kn === 'Unit Price Amount') {
      subItem.unitPrice = value;
    } else if (kn === 'Entity Identifier') {
      if (value.includes('Ship To')) {
        subItem.shipTo = value.replace(/^\s*Ship To\s*/, '').trim();
      }
    } else if (kn === 'DoD Identification') {
      if (value.includes('DODAAC')) {
        const dodMatch = value.match(/DODAAC\)?\s*(\S+)/);
        if (dodMatch) subItem.dodaac = dodMatch[1];
      }
    } else if (kn === 'Mark For' || key.includes('MARK FOR')) {
      subItem.markFor = value;
    } else if (kn === 'Condition' || key.includes('Condition')) {
      subItem.condition = value;
    } else if (kn === 'Priority Rating' || key.includes('Priority')) {
      subItem.priorityRating = value;
    } else if (
      kn === 'Internal Order Number' ||
      key.includes('Internal Order')
    ) {
      subItem.internalOrderNumber = value;
    } else if (
      kn === 'Product/Item Description' ||
      key.includes('Product Description')
    ) {
      subItem.productDescription = value;
    } else if (kn === 'Data Category Code') {
      subItem.dataCategoryCode = value;
    } else if (kn === 'Preparer' || key.includes('Preparer')) {
      subItem.preparer = value;
    } else if (kn === 'Authorizer' || key.includes('Authorizer')) {
      subItem.authorizer = value;
    } else if (
      key.includes('Date') &&
      (key.includes('Production') || key.includes('Approved'))
    ) {
      if (!subItem.dateReferences) subItem.dateReferences = [];
      const type = key.includes('Production') ? 'Production' : 'Approved';
      subItem.dateReferences.push({ type, date: value });
    }

    // City/State/Zip from inline after DODAAC
    if (
      value.match(/^[A-Z][A-Z\s]+,\s*[A-Z]{2}\s+\d{5}/) &&
      !subItem.cityStateZip
    ) {
      subItem.cityStateZip = value;
    }
  }

  // =================================================================
  // PACKAGING EXTRACTION
  // =================================================================

  private static parsePackagingFromTable(
    $: cheerio.CheerioAPI,
    table: cheerio.Cheerio<AnyNode>,
    lineItem: NecoLineItem,
  ): void {
    const codes: Record<string, string> = {};
    let standard: string | undefined;

    table.find('td.tbl_hdr, .tbl_hdr').each((_, el) => {
      const key = $(el).text().trim().replace(/:$/, '');
      const valCell = $(el).next('td.tbl_itm_sm, .tbl_itm_sm, td.tbl_itm, .tbl_itm');
      if (!valCell.length) return;
      const val = valCell.text().trim();
      if (!val || !key) return;

      if (key.toLowerCase().includes('standard') || key.toLowerCase().includes('mil-std')) {
        standard = val;
      } else {
        codes[key] = val;
      }
    });

    // Also extract from inline pairs
    table.find('td.tbl_itm_sm, .tbl_itm_sm').each((_, el) => {
      const raw = $(el).text().trim();
      if (!raw) return;
      // Pattern: "Packing  EQQ"
      const match = raw.match(/^([A-Za-z\s/]+?)\s{2,}(\S+)$/);
      if (match) {
        codes[match[1].trim()] = match[2].trim();
      }
      if (raw.includes('MIL-STD')) {
        standard = raw;
      }
    });

    if (Object.keys(codes).length > 0) {
      lineItem.packagingCodes = codes;
    }
    if (standard) {
      lineItem.packagingStandard = standard;
    }
  }

  // =================================================================
  // PHYSICAL DETAILS EXTRACTION
  // =================================================================

  private static parsePhysicalDetailsFromTable(
    $: cheerio.CheerioAPI,
    table: cheerio.Cheerio<AnyNode>,
    lineItem: NecoLineItem,
  ): void {
    table.find('td.tbl_hdr, .tbl_hdr').each((_, el) => {
      const key = $(el).text().trim().replace(/:$/, '').toLowerCase();
      const valCell = $(el).next('td.tbl_itm_sm, .tbl_itm_sm, td.tbl_itm, .tbl_itm');
      if (!valCell.length) return;
      const val = valCell.text().trim();
      if (!val) return;

      if (key.includes('weight')) {
        lineItem.weight = val;
      } else if (key.includes('volume')) {
        lineItem.volume = val;
      } else if (key.includes('dimension')) {
        lineItem.dimensions = val;
      } else if (key.includes('pack') && key.includes('size')) {
        const num = parseInt(val, 10);
        if (!isNaN(num)) lineItem.packSize = num;
      } else if (key.includes('pack') && key.includes('unit')) {
        lineItem.packUnit = val;
      }
    });

    // Inline extraction
    table.find('td.tbl_itm_sm, .tbl_itm_sm').each((_, el) => {
      const raw = $(el).text().trim();
      if (!raw) return;

      const weightMatch = raw.match(/(?:Weight|Wt)[:\s]+(.+)/i);
      if (weightMatch && !lineItem.weight) lineItem.weight = weightMatch[1].trim();

      const volMatch = raw.match(/(?:Volume|Vol)[:\s]+(.+)/i);
      if (volMatch && !lineItem.volume) lineItem.volume = volMatch[1].trim();

      const dimMatch = raw.match(/(?:Dimension|L\/W\/H)[:\s]+(.+)/i);
      if (dimMatch && !lineItem.dimensions) lineItem.dimensions = dimMatch[1].trim();

      const packMatch = raw.match(/(?:Pack Size)[:\s]+(\d+)/i);
      if (packMatch && !lineItem.packSize) lineItem.packSize = parseInt(packMatch[1], 10);
    });
  }

  // =================================================================
  // SOW / CLAUSE REFERENCES EXTRACTION
  // =================================================================

  private static parseSowFromTable(
    $: cheerio.CheerioAPI,
    table: cheerio.Cheerio<AnyNode>,
    lineItem: NecoLineItem,
  ): void {
    const textBlocks: string[] = [];
    const drawings: string[] = [];
    const docRefs: string[] = [];

    table.find('td.tbl_itm_sm, .tbl_itm_sm, td.tbl_itm, .tbl_itm').each(
      (_, el) => {
        const raw = $(el).text().trim();
        if (!raw) return;
        textBlocks.push(raw);

        // Extract drawing numbers (patterns like RE-D102152, DWG-12345, etc.)
        const drawingMatches = raw.match(
          /\b(?:RE-[A-Z]?\d+|DWG[-\s]?\d+|[A-Z]{1,3}-[A-Z]?\d{4,})\b/g,
        );
        if (drawingMatches) {
          drawings.push(...drawingMatches);
        }

        // Extract document references (MIL-STD-xxx, ISO xxxx, etc.)
        const docMatches = raw.match(
          /\b(?:MIL-(?:STD|SPEC|PRF|DTL|HDBK)-\S+|ISO\s*\d+|SAE\s+\S+|ASTM\s+\S+|AS\d{4,}|AMS\s*\d+)\b/g,
        );
        if (docMatches) {
          docRefs.push(...docMatches);
        }
      },
    );

    // Also check for CAGE reference
    table.find('td.tbl_itm_sm, .tbl_itm_sm').each((_, el) => {
      const raw = $(el).text().trim();
      const cageMatch = raw.match(/CAGE[_\s]*(?:Ref\.?\s*No\.?)?[:\s]*;?\s*(\S+)\s+(\S+)/i);
      if (cageMatch && !lineItem.vendorCode) {
        lineItem.vendorCode = cageMatch[1].replace(/[;]/g, '');
        lineItem.vendorPartNumber = cageMatch[2].replace(/[;]/g, '');
        lineItem.cageRefNo = `${cageMatch[1]} ${cageMatch[2]}`.replace(/[;]/g, '').trim();
      }
    });

    if (textBlocks.length > 0) {
      lineItem.sowText = textBlocks.join('\n').substring(0, 5000);
    }
    if (drawings.length > 0) {
      lineItem.drawingNumbers = [...new Set(drawings)];
    }
    if (docRefs.length > 0) {
      lineItem.documentReferences = [...new Set(docRefs)];
    }
  }

  // =================================================================
  // CDRL ITEMS EXTRACTION
  // =================================================================

  private static extractCdrlItems(
    $: cheerio.CheerioAPI,
    cdrlSections: Array<{
      name: string;
      table: cheerio.Cheerio<AnyNode>;
    }>,
  ): NecoCdrlItem[] {
    const items: NecoCdrlItem[] = [];
    const allHeaders = $('td.tbl_hdr_lg, .tbl_hdr_lg').toArray();

    for (let i = 0; i < allHeaders.length; i++) {
      const headerText = $(allHeaders[i]).text().trim();
      const hl = headerText.toLowerCase();
      // Only start a new CDRL item at the root "CDRL Line Items" header
      if (hl !== 'cdrl line items')
        continue;

      const currentTable = $(allHeaders[i]).closest('table');
      const contentTables: cheerio.Cheerio<AnyNode>[] = [currentTable];

      // Walk sibling tables collecting all CDRL sub-sections until next "CDRL Line Items" root
      let nextEl = currentTable.next();
      while (nextEl.length) {
        const nestedHeader = nextEl.find('td.tbl_hdr_lg, .tbl_hdr_lg');
        if (nestedHeader.length) {
          const nht = nestedHeader.first().text().trim().toLowerCase();
          // Stop at the NEXT "CDRL Line Items" root section (new CDRL item)
          if (nht === 'cdrl line items') {
            break;
          }
          // Stop at non-CDRL sections (e.g. "Sub-Line Items", "Line Items")
          if (
            !nht.includes('cdrl') &&
            !nht.includes('data requirement')
          ) {
            break;
          }
          // Otherwise it's a CDRL sub-section — include it
        }
        contentTables.push(nextEl as cheerio.Cheerio<AnyNode>);
        nextEl = nextEl.next();
      }

      const cdrlItem = this.parseCdrlFromTables($, contentTables);
      if (cdrlItem) {
        items.push(cdrlItem);
      }
    }

    return items;
  }

  private static parseCdrlFromTables(
    $: cheerio.CheerioAPI,
    tables: cheerio.Cheerio<AnyNode>[],
  ): NecoCdrlItem | null {
    const item: NecoCdrlItem = { cdrlItem: '' };

    for (const table of tables) {
      // Check section type via tbl_hdr_lg
      const headerLg = table.find('td.tbl_hdr_lg, .tbl_hdr_lg');
      const sectionType = headerLg.length
        ? headerLg.first().text().trim().toLowerCase()
        : '';

      // Parse key-value pairs from tbl_hdr -> tbl_itm_sm
      table.find('td.tbl_hdr, .tbl_hdr').each((_, el) => {
        const key = $(el).text().trim().replace(/:$/, '');
        const valCell = $(el).next(
          'td.tbl_itm_sm, .tbl_itm_sm, td.tbl_itm, .tbl_itm',
        );
        if (!valCell.length) return;
        const val = valCell.text().trim().replace(/[\u00A0]+/g, ' ').trim();
        if (!val) return;

        const kl = key.toLowerCase();
        if (
          kl.includes('cdrl') ||
          kl.includes('data item') ||
          kl === 'item'
        ) {
          item.cdrlItem = val;
        } else if (kl === 'description' || kl === '') {
          // TITLE= and SUBTITLE= patterns (key can be empty for continuation rows)
          const titleMatch = val.match(/TITLE=(.+)/i);
          if (titleMatch && !item.title) item.title = titleMatch[1].trim();
          const subMatch = val.match(/SUBTITLE=(.+)/i);
          if (subMatch) item.subtitle = subMatch[1].trim();
        } else if (kl.includes('item description type')) {
          item.descriptionType = val;
        } else if (kl.includes('lead time')) {
          item.leadTime = val;
          const daysMatch = val.match(/(\d+)\s*(?:Calendar\s*)?Days/i);
          if (daysMatch) item.leadTimeDays = parseInt(daysMatch[1], 10);
        } else if (kl.includes('agency')) {
          item.agencyQualifier = val;
        } else if (kl.includes('code list')) {
          item.codeListQualifier = val;
        } else if (kl.includes('industry')) {
          item.industryList = val;
        } else if (kl.includes('entity identifier')) {
          if (!item.shipToLocations) item.shipToLocations = [];
          item.shipToLocations.push({ entity: val });
        }
      });

      // Delivery Lead Time section (uses tbl_hdr_sm columns, not tbl_hdr)
      if (sectionType.includes('lead time') || sectionType.includes('delivery')) {
        table.find('tr').each((_, row) => {
          const cells = $(row).find('td.tbl_itm_sm, .tbl_itm_sm');
          if (cells.length >= 2 && !item.leadTime) {
            const leadText = $(cells[0]).text().trim().replace(/[\u00A0]+/g, ' ');
            const periodText = $(cells[1]).text().trim().replace(/[\u00A0]+/g, ' ');
            if (leadText && periodText) {
              item.leadTime = `${leadText} - ${periodText}`;
              const daysMatch = periodText.match(/(\d+)\s*(?:Maximum\s*)?(?:Calendar\s*)?Days/i);
              if (daysMatch) item.leadTimeDays = parseInt(daysMatch[1], 10);
            }
          }
        });
      }

      // Reference Numbers section — capture all reference entries
      if (sectionType.includes('reference number')) {
        table.find('td.tbl_itm_sm, .tbl_itm_sm').each((_, el) => {
          const raw = $(el).text().trim().replace(/[\u00A0]+/g, ' ').trim();
          if (!raw) return;
          // DI- references
          const diMatch = raw.match(/\b(DI-[A-Z]+-\d+[A-Z]?(?:\s*\([^)]+\))?)\b/);
          if (diMatch) {
            if (!item.referenceNumbers) item.referenceNumbers = [];
            if (!item.referenceNumbers.includes(diMatch[1])) {
              item.referenceNumbers.push(diMatch[1]);
            }
          }
          // Other reference entries (Form 250 code, Approval Code, etc.)
          if (!item.referenceDetails) item.referenceDetails = [];
          if (raw.length > 2 && !item.referenceDetails.includes(raw)) {
            item.referenceDetails.push(raw);
          }
        });
      }

      // Clause References section
      if (sectionType.includes('clause reference')) {
        table.find('td.tbl_itm_sm, .tbl_itm_sm').each((_, el) => {
          const raw = $(el).text().trim().replace(/[\u00A0]+/g, ' ').trim();
          if (!raw) return;
          if (!item.clauseReferences) item.clauseReferences = [];
          if (!item.clauseReferences.includes(raw)) {
            item.clauseReferences.push(raw);
          }
        });
      }

      // Organization/Location sections (delivery + quantity)
      if (sectionType.includes('organization') || sectionType.includes('location')) {
        table.find('tr').each((_, row) => {
          const cells = $(row).find('td.tbl_itm_sm, .tbl_itm_sm');
          if (cells.length >= 2) {
            const vals = cells.toArray().map(c => $(c).text().trim().replace(/[\u00A0]+/g, ' ').trim()).filter(Boolean);
            if (vals.length > 0) {
              if (!item.organizationLocations) item.organizationLocations = [];
              item.organizationLocations.push(vals.join(' | '));
            }
          }
        });
      }
    }

    return item.cdrlItem ? item : null;
  }

  // =================================================================
  // LEGACY: Extract single line item from whole page
  // =================================================================

  private static extractSingleLineItemFromPage(
    $: cheerio.CheerioAPI,
  ): NecoLineItem | null {
    const subPairs = this.extractSubPairs($);
    const inlinePairs = this.extractInlinePairs($);
    const structuredPairs = this.extractStructuredPairs($);

    const lineItemNum =
      subPairs.get('Line Item:') || subPairs.get('Line Item') || '0001';

    const lineItem: NecoLineItem = {
      lineItem: lineItemNum,
      subLineItems: [],
    };

    // NSN
    lineItem.nsn = inlinePairs.get('National Stock Number') || undefined;

    // Nomenclature
    lineItem.nomenclature =
      inlinePairs.get('Nomenclature') ||
      structuredPairs.get('General Desc:') ||
      structuredPairs.get('General Desc') ||
      undefined;

    // Material codes
    lineItem.materialControlCode =
      inlinePairs.get('Material Control Code') || undefined;
    lineItem.specialMaterialIdCode =
      inlinePairs.get('Special Material Identification Code') || undefined;
    lineItem.shelfLifeCode = inlinePairs.get('Shelf-Life Code') || undefined;
    lineItem.shelfLifeActionCode =
      inlinePairs.get('Shelf-Life Action Code') || undefined;

    // Vendor
    const vendorRaw = inlinePairs.get("Vendor's (Seller's) Part Number");
    if (vendorRaw) {
      const parts = vendorRaw.trim().split(/\s+/);
      if (parts.length >= 2) {
        lineItem.vendorCode = parts[0];
        lineItem.vendorPartNumber = parts.slice(1).join(' ');
      } else if (parts.length === 1) {
        lineItem.vendorCode = parts[0];
      }
    }

    // CAGE fallback
    if (!lineItem.vendorCode) {
      const cageRef = inlinePairs.get('CAGE___Ref. No.');
      if (cageRef) {
        const cleaned = cageRef.replace(/[;]/g, '').trim();
        const parts = cleaned.split(/\s+/);
        if (parts.length >= 2) {
          lineItem.vendorCode = parts[0];
          lineItem.vendorPartNumber = parts.slice(1).join(' ');
        }
        lineItem.cageRefNo = cleaned;
      }
    }

    // Quantity
    const qtyRaw = subPairs.get('Quantity:') || subPairs.get('Quantity');
    if (qtyRaw) {
      const parsed = this.parseQuantityValue(qtyRaw);
      if (parsed) {
        lineItem.quantity = parsed.quantity;
        lineItem.unit = parsed.unit;
      }
    }
    // Fallback quantity from structured pairs
    if (!lineItem.quantity) {
      const qtyItm =
        structuredPairs.get('Quantity:') || structuredPairs.get('Quantity');
      if (qtyItm) {
        const parsed = this.parseQuantityValue(qtyItm);
        if (parsed) {
          lineItem.quantity = parsed.quantity;
          lineItem.unit = parsed.unit;
        }
      }
    }

    // Sub-line items (legacy)
    const subItems = this.extractSubLineItemsLegacy($);
    lineItem.subLineItems = subItems;

    // Fallback quantity from sub-line items
    if (!lineItem.quantity || lineItem.quantity === 0) {
      const totalQty = subItems.reduce(
        (sum, s) => sum + (s.quantity || 0),
        0,
      );
      if (totalQty > 0) {
        lineItem.quantity = totalQty;
        lineItem.unit = subItems[0]?.unit;
      }
    }

    // Only return if we have some meaningful data
    if (
      lineItem.nsn ||
      lineItem.nomenclature ||
      lineItem.vendorCode ||
      lineItem.quantity
    ) {
      return lineItem;
    }
    return null;
  }

  // =================================================================
  // BACKWARD COMPATIBILITY: Flatten first line item
  // =================================================================

  private static flattenFirstLineItem(result: NecoExtractedData): void {
    if (result.lineItems.length === 0) return;

    const first = result.lineItems[0];
    result.lineItem = first.lineItem;
    result.nomenclature = first.nomenclature;
    result.nsn = first.nsn;
    result.quantity = first.quantity;
    result.unit = first.unit;
    result.vendorCode = first.vendorCode;
    result.vendorPartNumber = first.vendorPartNumber;
    result.materialControlCode = first.materialControlCode;
    result.specialMaterialIdCode = first.specialMaterialIdCode;
    result.shelfLifeCode = first.shelfLifeCode;
    result.cageRefNo = first.cageRefNo;

    // Flatten sub-line items (legacy format)
    if (first.subLineItems.length > 0) {
      result.subLineItems = first.subLineItems.map((sub) => ({
        subLineItem: sub.subLineItem,
        quantity: sub.quantity,
        unit: sub.unit,
        shipTo: sub.shipTo,
        dodaac: sub.dodaac,
      }));
    }
  }

  // =================================================================
  // HELPER: Extract structured pairs (tbl_hdr + tbl_itm)
  // =================================================================

  private static extractStructuredPairs(
    $: cheerio.CheerioAPI,
  ): Map<string, string> {
    const pairs = new Map<string, string>();
    $('td.tbl_hdr, .tbl_hdr').each((_, el) => {
      const key = $(el).text().trim();
      if (!key) return;
      const nextTd = $(el).next('td.tbl_itm, .tbl_itm');
      if (nextTd.length) {
        const value = nextTd.text().trim();
        if (value) pairs.set(key, value);
        return;
      }
      const parentRow = $(el).closest('tr');
      const valueCell = parentRow.find('td.tbl_itm, .tbl_itm').first();
      if (valueCell.length) {
        const value = valueCell.text().trim();
        if (value) pairs.set(key, value);
      }
    });
    return pairs;
  }

  // =================================================================
  // HELPER: Extract sub pairs (tbl_hdr + tbl_itm_sm)
  // =================================================================

  private static extractSubPairs(
    $: cheerio.CheerioAPI,
  ): Map<string, string> {
    const pairs = new Map<string, string>();
    $('td.tbl_hdr, .tbl_hdr').each((_, el) => {
      const key = $(el).text().trim();
      if (!key) return;
      const nextTd = $(el).next('td.tbl_itm_sm, .tbl_itm_sm');
      if (nextTd.length) {
        const value = nextTd.text().trim();
        if (value) {
          if (!pairs.has(key)) pairs.set(key, value);
        }
      }
    });
    return pairs;
  }

  // =================================================================
  // HELPER: Extract inline pairs from tbl_itm_sm
  // =================================================================

  private static extractInlinePairs(
    $: cheerio.CheerioAPI,
  ): Map<string, string> {
    const pairs = new Map<string, string>();

    $('td.tbl_itm_sm, .tbl_itm_sm').each((_, el) => {
      const raw = $(el).text().trim();
      if (!raw || raw.length < 3) return;
      this.parseInlineText(raw, pairs);
    });

    return pairs;
  }

  // =================================================================
  // HELPER: Parse inline text into key-value pairs
  // =================================================================

  private static parseInlineText(
    raw: string,
    pairs: Map<string, string>,
  ): void {
    // Format 1: "Key:  Value" or "Key: &nbsp;Value"
    const colonMatch = raw.match(
      /^(.+?):\s{2,}(.+)$|^(.+?):\s*\xA0\s*(.+)$/,
    );
    if (colonMatch) {
      const key = (colonMatch[1] || colonMatch[3]).trim();
      const value = (colonMatch[2] || colonMatch[4]).trim();
      if (key && value && !pairs.has(key)) {
        pairs.set(key, value);
        return;
      }
    }

    // Format 2: Known labels with spaces
    for (const label of KNOWN_LABELS) {
      const idx = raw.indexOf(label);
      if (idx >= 0 && idx <= 5) {
        const value = raw.substring(idx + label.length).trim();
        if (value && !pairs.has(label)) {
          pairs.set(label, value);
          return;
        }
      }
    }

    // Format 3: Standalone patterns
    const standalonePatterns = [
      /^(Unrestricted.+)$/i,
      /^(Small Purchase Set Aside.+)$/i,
      /^(From Date of Award.+)$/i,
      /^(Defense Priorities.+)$/i,
    ];
    for (const pattern of standalonePatterns) {
      const match = raw.match(pattern);
      if (match && !pairs.has(match[1])) {
        pairs.set(match[1], match[1]);
        return;
      }
    }
  }

  // =================================================================
  // HELPER: Extract Lead Time
  // =================================================================

  private static extractLeadTime(
    $: cheerio.CheerioAPI,
    result: NecoExtractedData,
    inlinePairs: Map<string, string>,
  ): void {
    $('td.tbl_hdr_lg, .tbl_hdr_lg').each((_, el) => {
      const text = $(el).text().trim();
      if (!text.includes('Lead Time')) return;

      const parentTable = $(el).closest('table');
      const rows = parentTable.find('tr');
      const leadTimeData: string[] = [];

      rows.each((_, row) => {
        const cells = $(row).find('td.tbl_itm_sm, .tbl_itm_sm');
        if (cells.length > 0) {
          const rowTexts: string[] = [];
          cells.each((_, cell) => {
            const t = $(cell).text().trim();
            if (t) rowTexts.push(t);
          });
          if (rowTexts.length > 0) {
            leadTimeData.push(rowTexts.join(' | '));
          }
        }
      });

      if (leadTimeData.length > 0) {
        result.leadTime = leadTimeData.join('; ');
        const daysMatch = result.leadTime.match(/(\d+)\s*Calendar\s*Days/i);
        if (daysMatch) {
          result.leadTimeDays = parseInt(daysMatch[1], 10);
        }
      }
    });

    // Fallback
    if (!result.leadTime) {
      for (const [key, value] of inlinePairs) {
        if (key.toLowerCase().includes('date of award')) {
          result.leadTime = key;
          for (const [, v2] of inlinePairs) {
            const daysMatch = v2.match(/(\d+)\s*Calendar\s*Days/i);
            if (daysMatch) {
              result.leadTimeDays = parseInt(daysMatch[1], 10);
              result.leadTime = `${key} | ${v2}`;
              break;
            }
          }
          break;
        }
      }
    }
  }

  // =================================================================
  // HELPER: Extract Sub-Line Items globally (they appear after CDRLs)
  // =================================================================

  private static extractSubLineItemsGlobal(
    $: cheerio.CheerioAPI,
  ): NecoSubLineItem[] {
    const items: NecoSubLineItem[] = [];
    const allHeaders = $('td.tbl_hdr_lg, .tbl_hdr_lg').toArray();

    for (let i = 0; i < allHeaders.length; i++) {
      const headerText = $(allHeaders[i]).text().trim().toLowerCase();
      if (headerText !== 'sub-line items') continue;

      // Collect all tables for this sub-line item section
      const currentTable = $(allHeaders[i]).closest('table');
      const contentTables: cheerio.Cheerio<AnyNode>[] = [currentTable];

      let nextEl = currentTable.next();
      while (nextEl.length) {
        const nestedHeader = nextEl.find('td.tbl_hdr_lg, .tbl_hdr_lg');
        if (nestedHeader.length) {
          const nht = nestedHeader.first().text().trim().toLowerCase();
          // Stop at next "Sub-Line Items" root or non-sub-line section
          if (nht === 'sub-line items') break;
          if (!nht.includes('sub-line')) break;
        }
        contentTables.push(nextEl as cheerio.Cheerio<AnyNode>);
        nextEl = nextEl.next();
      }

      // Extract sub-line item from collected tables
      const subItem: NecoSubLineItem = { subLineItem: '' };
      for (const table of contentTables) {
        table.find('td.tbl_hdr, .tbl_hdr').each((_, el) => {
          const key = $(el).text().trim();
          const valCell = $(el).next('td.tbl_itm_sm, .tbl_itm_sm, td.tbl_itm, .tbl_itm');
          if (!valCell.length) return;
          const val = valCell.text().trim().replace(/[\u00A0]+/g, ' ').trim();
          if (!val) return;

          if (key === 'Sub-Line Item:' || key === 'Sub-Line Item') {
            subItem.subLineItem = val;
          } else {
            this.assignSubLineField(subItem, key, val);
          }
        });

        // Also extract from tbl_itm_sm cells (Reference Numbers, Marks and Numbers)
        const sectionHeader = table.find('td.tbl_hdr_lg, .tbl_hdr_lg');
        const sectionName = sectionHeader.length ? sectionHeader.first().text().trim().toLowerCase() : '';
        if (sectionName.includes('marks') || sectionName.includes('mark')) {
          table.find('td.tbl_itm_sm, .tbl_itm_sm').each((_, el) => {
            const raw = $(el).text().trim().replace(/[\u00A0]+/g, ' ').trim();
            if (raw.includes('MARK FOR:')) {
              subItem.markFor = raw.replace('MARK FOR:', '').trim();
            }
          });
        }
        if (sectionName.includes('reference number')) {
          table.find('td.tbl_itm_sm, .tbl_itm_sm').each((_, el) => {
            const raw = $(el).text().trim().replace(/[\u00A0]+/g, ' ').trim();
            if (raw.includes('Priority Rating')) {
              const match = raw.match(/Priority Rating\s+(\S+)/);
              if (match) subItem.priorityRating = match[1];
            }
          });
        }
      }
      if (subItem.subLineItem) {
        items.push(subItem);
      }
    }

    return items;
  }

  // =================================================================
  // HELPER: Extract Sub-Line Items (legacy whole-page approach)
  // =================================================================

  private static extractSubLineItemsLegacy(
    $: cheerio.CheerioAPI,
  ): NecoSubLineItem[] {
    const items: NecoSubLineItem[] = [];
    let currentItem: NecoSubLineItem | null = null;

    $('td.tbl_hdr, .tbl_hdr').each((_, el) => {
      const key = $(el).text().trim();
      const nextTd = $(el).next('td.tbl_itm_sm, .tbl_itm_sm');
      if (!nextTd.length) return;
      const value = nextTd.text().trim();

      if (key === 'Sub-Line Item:' || key === 'Sub-Line Item') {
        if (currentItem) items.push(currentItem);
        currentItem = { subLineItem: value };
      } else if (currentItem) {
        this.assignSubLineField(currentItem, key, value);
      }
    });

    if (currentItem) items.push(currentItem);
    return items;
  }

  // =================================================================
  // HELPER: Parse quantity string "5 Each"
  // =================================================================

  private static parseQuantityValue(
    raw: string,
  ): { quantity: number; unit?: string } | null {
    // Normalize non-breaking spaces (\xa0) and trim
    const cleaned = raw.replace(/[\u00A0]+/g, ' ').trim();
    const qtyMatch = cleaned.match(/^(\d+)\s+(.+)$/);
    if (qtyMatch) {
      return {
        quantity: parseInt(qtyMatch[1], 10),
        unit: qtyMatch[2].trim(),
      };
    }
    const numOnly = parseInt(cleaned, 10);
    if (!isNaN(numOnly) && numOnly > 0) {
      return { quantity: numOnly };
    }
    return null;
  }

  // =================================================================
  // HELPER: Find in map (partial, case-insensitive)
  // =================================================================

  private static findInMap(
    map: Map<string, string>,
    searchKey: string,
  ): string | undefined {
    const searchLower = searchKey.toLowerCase();
    for (const [key, value] of map) {
      if (key.toLowerCase().includes(searchLower)) {
        return value;
      }
    }
    return undefined;
  }
}

// =================================================================
// Module-level helper
// =================================================================

function pageTextMatch(
  $: cheerio.CheerioAPI,
  pattern: RegExp,
): RegExpMatchArray | null {
  const text = $('body').text();
  return text.match(pattern);
}
