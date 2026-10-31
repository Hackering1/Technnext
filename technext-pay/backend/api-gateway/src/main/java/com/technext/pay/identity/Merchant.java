package com.technext.pay.identity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name="merchants")
public class Merchant {
    @Id private UUID id;
    @Column(name="legal_name", nullable=false, length=200) private String legalName;
    @Enumerated(EnumType.STRING) @Column(nullable=false, length=24) private MerchantStatus status;
    @Column(name="created_at", nullable=false) private Instant createdAt;
    protected Merchant() {}
    public Merchant(String legalName) { this.id=UUID.randomUUID(); this.legalName=legalName; this.status=MerchantStatus.REGISTERED; this.createdAt=Instant.now(); }
    public UUID getId(){return id;} public String getLegalName(){return legalName;} public MerchantStatus getStatus(){return status;}
}

