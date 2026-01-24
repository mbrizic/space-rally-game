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

    constructor(poolSize = 500) {
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
                color: "rgba(180, 185, 195, 0.4)", // Light gray smoke
                sizeM: 0.18,
                lifetime: 0.6,
                spawnRate: 20 // particles per second (increased)
            };
        case "gravel":
            return {
                color: "rgba(210, 190, 140, 0.5)", // Tan/beige dust
                sizeM: 0.22,
                lifetime: 0.8,
                spawnRate: 30 // increased
            };
        case "dirt":
            return {
                color: "rgba(165, 125, 90, 0.5)", // Brown dust
                sizeM: 0.20,
                lifetime: 0.75,
                spawnRate: 25 // increased
            };
        case "ice":
            return {
                color: "rgba(200, 230, 255, 0.3)", // Light blue ice crystals
                sizeM: 0.15,
                lifetime: 0.4,
                spawnRate: 35 // More particles for ice spray
            };
        case "offtrack":
            return {
                color: "rgba(140, 165, 130, 0.4)", // Green-gray dust
                sizeM: 0.16,
                lifetime: 0.5,
                spawnRate: 15 // increased
            };
    }
}
