/**
 * Reset seguro do banco de dados
 *
 * Preserva contas Gmail conectadas durante o reset.
 *
 * Uso: npx ts-node prisma/reset-safe.ts
 *
 * O que faz:
 * 1. Faz backup das contas Gmail (tokens OAuth)
 * 2. Executa prisma migrate reset --force (drop + migrate + seed)
 * 3. Restaura as contas Gmail associando ao usuário recriado
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

const prisma = new PrismaClient();

interface GmailBackup {
  email: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: Date | null;
  isActive: boolean;
  lastSync: Date | null;
  userEmail: string; // para re-associar ao user correto
}

async function main() {
  // =========================================================================
  // 1. Backup das contas Gmail
  // =========================================================================
  console.log('📦 Fazendo backup das contas Gmail...');

  let gmailBackups: GmailBackup[] = [];

  try {
    const gmailAccounts = await prisma.gmailAccount.findMany({
      include: { user: { select: { email: true } } },
    });

    gmailBackups = gmailAccounts.map((account) => ({
      email: account.email,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      tokenExpiry: account.tokenExpiry,
      isActive: account.isActive,
      lastSync: null, // Reset lastSync para reprocessar todos os emails
      userEmail: account.user.email,
    }));

    if (gmailBackups.length > 0) {
      console.log(`   ✅ ${gmailBackups.length} conta(s) Gmail salvas:`);
      gmailBackups.forEach((g) => console.log(`      - ${g.email} (user: ${g.userEmail})`));
    } else {
      console.log('   ℹ️  Nenhuma conta Gmail encontrada');
    }
  } catch (err) {
    console.log('   ℹ️  Banco vazio ou inacessível, prosseguindo sem backup');
  }

  await prisma.$disconnect();

  // =========================================================================
  // 2. Executar prisma migrate reset
  // =========================================================================
  console.log('\n🔄 Executando prisma migrate reset...');
  try {
    execSync('npx prisma migrate reset --force', {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
  } catch (err) {
    console.error('❌ Erro ao executar migrate reset');
    process.exit(1);
  }

  // =========================================================================
  // 3. Restaurar contas Gmail
  // =========================================================================
  if (gmailBackups.length === 0) {
    console.log('\n✅ Reset completo! Nenhuma conta Gmail para restaurar.');
    return;
  }

  console.log('\n📥 Restaurando contas Gmail...');
  const prisma2 = new PrismaClient();

  try {
    for (const backup of gmailBackups) {
      // Encontrar o usuário pelo email (recriado pelo seed)
      const user = await prisma2.user.findUnique({
        where: { email: backup.userEmail },
      });

      if (!user) {
        console.log(`   ⚠️  Usuário ${backup.userEmail} não encontrado, pulando ${backup.email}`);
        continue;
      }

      // Verificar se já existe (seed pode ter criado)
      const existing = await prisma2.gmailAccount.findFirst({
        where: { userId: user.id, email: backup.email },
      });

      if (existing) {
        console.log(`   ℹ️  ${backup.email} já existe, atualizando tokens...`);
        await prisma2.gmailAccount.update({
          where: { id: existing.id },
          data: {
            accessToken: backup.accessToken,
            refreshToken: backup.refreshToken,
            tokenExpiry: backup.tokenExpiry,
            isActive: backup.isActive,
            lastSync: backup.lastSync,
          },
        });
      } else {
        await prisma2.gmailAccount.create({
          data: {
            userId: user.id,
            email: backup.email,
            accessToken: backup.accessToken,
            refreshToken: backup.refreshToken,
            tokenExpiry: backup.tokenExpiry,
            isActive: backup.isActive,
            lastSync: backup.lastSync,
          },
        });
      }

      console.log(`   ✅ ${backup.email} restaurada com sucesso`);
    }

    console.log('\n🎉 Reset completo! Contas Gmail preservadas e lastSync resetado para reprocessar todos os emails.');
  } catch (err) {
    console.error('❌ Erro ao restaurar contas Gmail:', err);
  } finally {
    await prisma2.$disconnect();
  }
}

main().catch((err) => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
