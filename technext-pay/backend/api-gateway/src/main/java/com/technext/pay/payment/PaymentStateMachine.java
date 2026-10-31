package com.technext.pay.payment;
import java.util.Map; import java.util.Set;
public final class PaymentStateMachine {
 private static final Map<PaymentStatus,Set<PaymentStatus>> ALLOWED=Map.of(PaymentStatus.CREATED,Set.of(PaymentStatus.INITIATED,PaymentStatus.FAILED,PaymentStatus.CANCELLED),PaymentStatus.INITIATED,Set.of(PaymentStatus.AUTHORIZED,PaymentStatus.CAPTURED,PaymentStatus.FAILED,PaymentStatus.CANCELLED),PaymentStatus.AUTHORIZED,Set.of(PaymentStatus.CAPTURED,PaymentStatus.FAILED,PaymentStatus.CANCELLED),PaymentStatus.CAPTURED,Set.of(PaymentStatus.PARTIALLY_REFUNDED,PaymentStatus.REFUNDED),PaymentStatus.PARTIALLY_REFUNDED,Set.of(PaymentStatus.PARTIALLY_REFUNDED,PaymentStatus.REFUNDED),PaymentStatus.FAILED,Set.of(),PaymentStatus.CANCELLED,Set.of(),PaymentStatus.REFUNDED,Set.of());
 private PaymentStateMachine(){} public static PaymentStatus transition(PaymentStatus from,PaymentStatus to){if(!ALLOWED.getOrDefault(from,Set.of()).contains(to))throw new IllegalStateException("invalid_payment_transition:"+from+"->"+to);return to;}
}

