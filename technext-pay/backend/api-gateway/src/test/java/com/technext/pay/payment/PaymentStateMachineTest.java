package com.technext.pay.payment;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class PaymentStateMachineTest {
    @Test void capturedPaymentCanBeRefunded() {
        assertEquals(PaymentStatus.REFUNDED, PaymentStateMachine.transition(PaymentStatus.CAPTURED, PaymentStatus.REFUNDED));
    }
    @Test void failedPaymentCannotMoveBackToCaptured() {
        assertThrows(IllegalStateException.class, () -> PaymentStateMachine.transition(PaymentStatus.FAILED, PaymentStatus.CAPTURED));
    }
    @Test void createdPaymentMustBeInitiatedBeforeCapture() {
        assertThrows(IllegalStateException.class, () -> PaymentStateMachine.transition(PaymentStatus.CREATED, PaymentStatus.CAPTURED));
    }
}

