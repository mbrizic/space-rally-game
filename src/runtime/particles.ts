import type { Surface } from "../sim/surface";

export type Particle = {
    active: boolean;
    x: number;
    y: number;
    vx: number;
    vy: number;
    lifetime: number; // seconds remaining
    maxLifetime: number; // total lifetime for fade calculation
    sizeM: number;
    color: string;
};

export class ParticlePool {
    private readonly particles: Particle[];
    private readonly poolSize: number;

    constructor(poolSize = 10000) {
        this.poolSize = poolSize;
        this.particles = [];
        for (let i = 0; i < poolSize; i++) {
            this.particles.push({
                active: false,
                x: 0,
                y: 0,
                vx: 0,
                vy: 0,
                lifetime: 0,
                maxLifetime: 1,
                sizeM: 0.1,
                color: "rgba(255,255,255,0.5)"
            });
        }
    }

    emit(opts: {
        x: number;
        y: number;
        vx: number;
        vy: number;
        lifetime: number;
        sizeM: number;
        color: string;
        count?: number;
    }): void {
        const count = opts.count ?? 1;
        let emitted = 0;

        for (let i = 0; i < this.poolSize && emitted < count; i++) {
            if (!this.particles[i].active) {
                const p = this.particles[i];
                p.active = true;
                p.x = opts.x;
                p.y = opts.y;
                p.vx = opts.vx;
                p.vy = opts.vy;
                p.lifetime = opts.lifetime;
                p.maxLifetime = opts.lifetime;
                p.sizeM = opts.sizeM;
                p.color = opts.color;
                emitted++;
            }
        }
    }

    update(dtSeconds: number): void {
        for (const p of this.particles) {
            if (!p.active) continue;

            p.lifetime -= dtSeconds;
            if (p.lifetime <= 0) {
                p.active = false;
                continue;
            }

            p.x += p.vx * dtSeconds;
            p.y += p.vy * dtSeconds;

            // Apply drag
            const drag = 0.92;
            p.vx *= Math.pow(drag, dtSeconds * 60);
            p.vy *= Math.pow(drag, dtSeconds * 60);
        }
    }

    getActiveParticles(): Particle[] {
        return this.particles.filter((p) => p.active);
    }

    reset(): void {
        for (const p of this.particles) {
            p.active = false;
        }
    }
}

// Surface-specific particle configurations
export function getParticleConfig(surface: Surface): {
    color: string;
    sizeM: number;
    lifetime: number;
    spawnRate: number;
} {
    switch (surface.name) {
        case "tarmac":
            return {
                color: "rgba(200, 205, 215, 0.75)", // BRIGHT gray smoke
                sizeM: 0.30, // BIGGER
                lifetime: 0.8, // Linger longer
                spawnRate: 35 // Moderate smoke
            };
        case "gravel":
            return {
                color: "rgba(230, 210, 160, 0.85)", // BRIGHT tan/beige dust
                sizeM: 0.42, // MUCH BIGGER
                lifetime: 1.5, // Linger longer
                spawnRate: 120 // MASSIVE dust clouds
            };
        case "dirt":
            return {
                color: "rgba(185, 145, 110, 0.80)", // BRIGHT brown dust
                sizeM: 0.38, // BIGGER
                lifetime: 1.3, // Linger longer
                spawnRate: 100 // Big dust plumes
            };
        case "ice":
            return {
                color: "rgba(220, 240, 255, 0.70)", // BRIGHT ice crystals
                sizeM: 0.28, // BIGGER
                lifetime: 0.8, // Linger longer
                spawnRate: 80 // Lots of ice spray
            };
        case "offtrack":
            return {
                color: "rgba(150, 130, 100, 0.70)", // Brown/tan dust (not green)
                sizeM: 0.32, // BIGGER
                lifetime: 1.0, // Linger longer
                spawnRate: 60 // Decent grass/dirt kick-up
            };
    }
}
