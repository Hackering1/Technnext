package com.technext.pay.identity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name="api_credentials", uniqueConstraints=@UniqueConstraint(name="uq_api_credentials_hash", columnNames="secret_hash"))
public class ApiCredential {
    @Id private UUID id;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="merchant_id",nullable=false) private Merchant merchant;
    @Column(name="public_key",nullable=false,length=80,unique=true) private String publicKey;
    @Column(name="secret_hash",nullable=false,length=64) private String secretHash;
    @Column(nullable=false,length=12) private String environment;
    @Column(name="created_at",nullable=false) private Instant createdAt;
    @Column(name="revoked_at") private Instant revokedAt;
    protected ApiCredential(){}
    public ApiCredential(Merchant merchant,String publicKey,String secretHash){this.id=UUID.randomUUID();this.merchant=merchant;this.publicKey=publicKey;this.secretHash=secretHash;this.environment="TEST";this.createdAt=Instant.now();}
    public UUID getId(){return id;} public Merchant getMerchant(){return merchant;} public String getEnvironment(){return environment;} public Instant getRevokedAt(){return revokedAt;}
}

