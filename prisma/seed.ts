import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ============================================================================
// DEFINIÇÃO DE PERMISSÕES (32 permissões em 11 módulos)
// ============================================================================
const ALL_PERMISSIONS = [
  // Opportunities (4)
  'opportunities.view',
  'opportunities.create',
  'opportunities.update',
  'opportunities.delete',
  // Templates (4)
  'templates.view',
  'templates.create',
  'templates.update',
  'templates.delete',
  // Gmail (3)
  'gmail.view',
  'gmail.create',
  'gmail.delete',
  // Scraping (2)
  'scraping.view',
  'scraping.manage',
  // Queues (1)
  'queues.view',
  // Alerts (2)
  'alerts.view',
  'alerts.manage',
  // Reports (2)
  'reports.view',
  'reports.export',
  // Users (4)
  'users.view',
  'users.create',
  'users.update',
  'users.delete',
  // Roles (4)
  'roles.view',
  'roles.create',
  'roles.update',
  'roles.delete',
  // Dashboard (1)
  'dashboard.view',
  // Settings (2)
  'settings.view',
  'settings.update',
  // Audit (1)
  'audit.view',
  // Suppliers (4)
  'suppliers.view',
  'suppliers.create',
  'suppliers.update',
  'suppliers.delete',
  // RFQs (5)
  'rfqs.view',
  'rfqs.create',
  'rfqs.send',
  'rfqs.update',
  'rfqs.delete',
];

// ============================================================================
// DEFINIÇÃO DE ROLES COM SUAS PERMISSÕES
// ============================================================================
const ROLES_CONFIG: Record<string, { permissions: string[]; isSystem: boolean }> = {
  'super-admin': {
    isSystem: true,
    permissions: [...ALL_PERMISSIONS], // Todas (32)
  },
  admin: {
    isSystem: true,
    permissions: ALL_PERMISSIONS.filter(
      (p) => !['audit.view', 'settings.update'].includes(p),
    ), // 30
  },
  manager: {
    isSystem: true,
    permissions: [
      'opportunities.view',
      'opportunities.create',
      'opportunities.update',
      'opportunities.delete',
      'templates.view',
      'templates.create',
      'templates.update',
      'gmail.view',
      'gmail.create',
      'scraping.view',
      'scraping.manage',
      'queues.view',
      'alerts.view',
      'alerts.manage',
      'reports.view',
      'reports.export',
      'dashboard.view',
      'users.view',
      'roles.view',
      'settings.view',
      'suppliers.view',
      'suppliers.create',
      'suppliers.update',
      'suppliers.delete',
      'rfqs.view',
      'rfqs.create',
      'rfqs.send',
      'rfqs.update',
      'rfqs.delete',
    ], // 29
  },
  operator: {
    isSystem: true,
    permissions: [
      'opportunities.view',
      'opportunities.create',
      'opportunities.update',
      'templates.view',
      'gmail.view',
      'scraping.view',
      'alerts.view',
      'reports.view',
      'dashboard.view',
      'suppliers.view',
      'suppliers.create',
      'suppliers.update',
      'rfqs.view',
      'rfqs.create',
      'rfqs.send',
      'rfqs.update',
    ], // 16
  },
  viewer: {
    isSystem: true,
    permissions: [
      'opportunities.view',
      'templates.view',
      'gmail.view',
      'reports.view',
      'dashboard.view',
      'scraping.view',
      'alerts.view',
    ], // 7
  },
};

async function main() {
  console.log('🌱 Seeding database...');

  // =========================================================================
  // 1. Criar/atualizar usuário principal
  // =========================================================================
  let user = await prisma.user.findUnique({
    where: { email: 'renato@atcsol.us' },
  });

  if (!user) {
    const passwordHash = await bcrypt.hash('senha123456', 10);
    user = await prisma.user.create({
      data: {
        email: 'renato@atcsol.us',
        name: 'Renato',
        passwordHash,
      },
    });
    console.log(`✅ Created user: ${user.email}`);
  } else {
    console.log(`✅ Found user: ${user.email}`);
  }

  // =========================================================================
  // 2. Criar permissões (upsert - seguro rodar múltiplas vezes)
  // =========================================================================
  console.log('📋 Creating permissions...');
  for (const permName of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: permName },
      update: {},
      create: {
        name: permName,
        guardName: 'api',
      },
    });
  }
  console.log(`✅ ${ALL_PERMISSIONS.length} permissions created/verified`);

  // =========================================================================
  // 3. Criar roles e atribuir permissões (upsert)
  // =========================================================================
  console.log('🎭 Creating roles...');
  for (const [roleName, config] of Object.entries(ROLES_CONFIG)) {
    // Upsert da role
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: { isSystem: config.isSystem },
      create: {
        name: roleName,
        guardName: 'api',
        isSystem: config.isSystem,
      },
    });

    // Buscar IDs das permissões desta role
    const permissions = await prisma.permission.findMany({
      where: { name: { in: config.permissions } },
    });

    // Limpar permissões existentes desta role
    await prisma.rolePermission.deleteMany({
      where: { roleId: role.id },
    });

    // Criar novas associações
    if (permissions.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissions.map((p) => ({
          roleId: role.id,
          permissionId: p.id,
        })),
      });
    }

    console.log(
      `  ✅ Role "${roleName}" → ${permissions.length} permissions`,
    );
  }

  // =========================================================================
  // 4. Atribuir role super-admin ao usuário principal
  // =========================================================================
  const superAdminRole = await prisma.role.findUnique({
    where: { name: 'super-admin' },
  });

  if (superAdminRole) {
    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: user.id,
          roleId: superAdminRole.id,
        },
      },
      update: {},
      create: {
        userId: user.id,
        roleId: superAdminRole.id,
      },
    });
    console.log(`✅ User "${user.email}" assigned role "super-admin"`);
  }

  // =========================================================================
  // 5. Templates de parsing (mantidos do seed original)
  // =========================================================================
  const necoExtractionConfig = {
    mode: 'multiline',
    itemDelimiter: 'NECO SOLICITATION NUMBER:',
    fields: [
      { name: 'necoSolicitationNumber', pattern: 'NECO SOLICITATION NUMBER:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'siteLocation', pattern: 'SITE LOCATION:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'transPurpose', pattern: 'TRANS PURPOSE:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'issueDate', pattern: 'ISSUE DATE:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'purchaseCategory', pattern: 'PURCHASE CATEGORY:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'quoteType', pattern: 'QUOTE TYPE:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'closingDate', pattern: 'CLOSING DATE:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'salesRequirement', pattern: 'SALES REQUIREMENT:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'hyperlink', pattern: 'HYPERLINK:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'productDescription', pattern: 'PRODUCT DESCRIPTION:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'materialControlCode', pattern: 'Material Control Code:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'nationalStockNumber', pattern: 'National Stock Number:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'nomenclature', pattern: 'Nomenclature:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'shelfLifeActionCode', pattern: 'Shelf-Life Action Code:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'shelfLifeCode', pattern: 'Shelf-Life Code:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'specialMaterialIdentificationCode', pattern: 'Special Material Identification Code:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'dataCategoryCode', pattern: 'Data Category Code:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'exhibitIdentifier', pattern: 'Exhibit Identifier:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'vendorsSellersPartNumber', pattern: "Vendor's \\(Seller's\\) Part Number:\\s*(.+?)(?=\\n|$)", type: 'regex', required: false },
      { name: 'commercialAndGovernmentEntityCageCode', pattern: 'Commercial and Government Entity \\(CAGE\\) Code:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'manufacturersPartNumber', pattern: "Manufacturer's Part Number:\\s*(.+?)(?=\\n|$)", type: 'regex', required: false },
      { name: 'generalDescription', pattern: 'GENERAL DESCRIPTION:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'federalSupplyClassification', pattern: 'Federal Supply Classification:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
      { name: 'description', pattern: 'DESCRIPTION:\\s*(.+?)(?=\\n|$)', type: 'regex', required: false },
    ],
  };

  const necoOutputSchema = {
    fingerprintFields: ['necoSolicitationNumber', 'siteLocation', 'transPurpose'],
    fieldMapping: {
      // Mapeamento para campos do DTO (opportunity)
      solicitationNumber: 'necoSolicitationNumber',
      site: 'siteLocation',
      sourceUrl: 'hyperlink',
      nsn: 'nationalStockNumber',
      partNumber: 'manufacturersPartNumber',
      description: 'nomenclature',
      closingDate: 'closingDate',
      transPurpose: 'transPurpose',
      quoteType: 'quoteType',
    },
  };

  const necoTemplate = await prisma.parsingTemplate.upsert({
    where: { id: 'seed-neco-template' },
    update: {
      extractionConfig: necoExtractionConfig,
      outputSchema: necoOutputSchema,
    },
    create: {
      id: 'seed-neco-template',
      userId: user.id,
      name: 'Template NECO',
      description:
        'Template para emails do NECO (Navy Electronics Contracting Office)',
      senderEmail: 'noreplyneco',
      subjectFilter: 'Daily Procurement Offerings',
      emailQuery: 'from:noreplyneco subject:Daily Procurement Offerings',
      extractionConfig: necoExtractionConfig,
      outputSchema: necoOutputSchema,
      isActive: true,
    },
  });

  // Cria WebScrapingConfig para NECO com domínio pré-configurado
  await prisma.webScrapingConfig.upsert({
    where: { templateId: necoTemplate.id },
    update: {},
    create: {
      templateId: necoTemplate.id,
      isEnabled: true,
      urlField: 'sourceUrl',
      extractionRules: {
        scrapingFields: [
          'nomenclature', 'quantity', 'vendorCode', 'vendorPartNumber', 'nsn',
          'contractType', 'buyerName', 'buyerEmail', 'buyerPhone', 'adminCommunications',
        ],
        templateDomains: [
          { domain: 'neco.navy.mil', enabled: true },
        ],
      },
    },
  });

  console.log(`✅ Created template: ${necoTemplate.name}`);

  // =========================================================================
  // 6. Template de email padrão para RFQ
  // =========================================================================
  const defaultRfqEmailBody = `<div style="font-family: Arial, sans-serif; max-width: 600px;">
<p>Dear {{supplierName}},</p>

<p>We are requesting a quote for the following item:</p>

<table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
  <tr style="background-color: #f3f4f6;">
    <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-weight: bold;">Solicitation #</td>
    <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">{{solicitationNumber}}</td>
  </tr>
  <tr>
    <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-weight: bold;">NSN</td>
    <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">{{nsn}}</td>
  </tr>
  <tr style="background-color: #f3f4f6;">
    <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-weight: bold;">Part Number</td>
    <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">{{partNumber}}</td>
  </tr>
  <tr>
    <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-weight: bold;">Description</td>
    <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">{{description}}</td>
  </tr>
  <tr style="background-color: #f3f4f6;">
    <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-weight: bold;">Quantity</td>
    <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">{{quantity}}</td>
  </tr>
  <tr>
    <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-weight: bold;">Deadline</td>
    <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">{{deadline}}</td>
  </tr>
</table>

<p>Please provide your best price, lead time, and condition (New/OH/AR/etc).</p>

<p>We would appreciate your response at your earliest convenience.</p>

<p>Best regards,<br/>ATC Solutions</p>
</div>`;

  await prisma.rfqEmailTemplate.upsert({
    where: { id: 'seed-default-rfq-template' },
    update: {
      body: defaultRfqEmailBody,
    },
    create: {
      id: 'seed-default-rfq-template',
      userId: user.id,
      name: 'Template Padrao de Cotacao',
      subject: 'Request for Quote - {{solicitationNumber}}',
      body: defaultRfqEmailBody,
      isDefault: true,
    },
  });
  console.log('✅ Created default RFQ email template');

  console.log('🎉 Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
