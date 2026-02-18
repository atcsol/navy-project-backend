export enum OpportunityStatus {
  NAO_ANALISADA = 'nao_analisada',
  ANALISADA = 'analisada',
  EM_COTACAO = 'em_cotacao',
  LANCADA_BID = 'lancada_bid',
  VENCEDORA_BID = 'vencedora_bid',
  NAO_VENCEDORA = 'nao_vencedora',
  CANCELADA = 'cancelada',
  DESCARTADA = 'descartada',
}

export enum ScrapingStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  BLOCKED = 'blocked',
  TIMEOUT = 'timeout',
  NECO_ERROR = 'neco_error',
  REQUIRES_AUTH = 'requires_auth',
  DISABLED = 'disabled',
  EXPIRED = 'expired',
}

export enum QuotationPhase {
  ENVIADA = 'enviada',
  RECEBIDA = 'recebida',
  EM_NEGOCIACAO = 'em_negociacao',
  FINALIZADA = 'finalizada',
}

export enum PurchaseStatus {
  PENDENTE = 'pendente',
  COMPRADA = 'comprada',
  ENTREGUE = 'entregue',
}

export enum UrgencyLevel {
  EXPIRED = 'expired',
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export const VALID_TRANSITIONS: Record<OpportunityStatus, OpportunityStatus[]> =
  {
    [OpportunityStatus.NAO_ANALISADA]: [
      OpportunityStatus.ANALISADA,
      OpportunityStatus.DESCARTADA,
      OpportunityStatus.CANCELADA,
    ],
    [OpportunityStatus.ANALISADA]: [
      OpportunityStatus.EM_COTACAO,
      OpportunityStatus.DESCARTADA,
      OpportunityStatus.CANCELADA,
    ],
    [OpportunityStatus.EM_COTACAO]: [
      OpportunityStatus.LANCADA_BID,
      OpportunityStatus.ANALISADA,
      OpportunityStatus.CANCELADA,
    ],
    [OpportunityStatus.LANCADA_BID]: [
      OpportunityStatus.VENCEDORA_BID,
      OpportunityStatus.NAO_VENCEDORA,
      OpportunityStatus.CANCELADA,
    ],
    [OpportunityStatus.VENCEDORA_BID]: [OpportunityStatus.CANCELADA],
    [OpportunityStatus.NAO_VENCEDORA]: [
      OpportunityStatus.ANALISADA,
      OpportunityStatus.CANCELADA,
    ],
    [OpportunityStatus.CANCELADA]: [],
    [OpportunityStatus.DESCARTADA]: [OpportunityStatus.NAO_ANALISADA],
  };

export const URGENCY_THRESHOLDS = {
  critical: 3,
  high: 7,
  medium: 14,
} as const;
