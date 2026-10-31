package com.technext.pay.identity;
import java.util.UUID;
public record MerchantPrincipal(UUID merchantId, UUID userId, String role, String environment) {}

