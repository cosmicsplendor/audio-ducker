const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

// Interface for speech data (for reference)
/*
interface SpeechData {
  text: string;
  start: number;
  duration: number;
  x?: number;
  y?: number;
  target?: string;
  offsetX?: number;
  offsetY?: number;
  type?: 'message' | 'thought';
  arrowDir?: 'up' | 'down' | 'left' | 'right';
  style?: 'minimal' | 'colorful' | 'comic';
  fontSize?: number;
  fontFamily?: string;
  audio?: string;
  volume?: number;
  maxWidth?: number;
}
*/

class AudioDucker {
  constructor(options = {}) {
    this.duckVolume = options.duckVolume || 0.2; // Volume during speech (20% of original)
    this.normalVolume = options.normalVolume || 1.0; // Normal volume (100%)
    this.fadeInDuration = options.fadeInDuration || 0.1; // Fade in duration in seconds
    this.fadeOutDuration = options.fadeOutDuration || 0.1; // Fade out duration in seconds
    this.outputDir = options.outputDir || './output';
    
    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Load and parse speech data from JSON file
   * @param {string} jsonPath - Path to the JSON file containing speech data
   * @returns {Array} Array of speech data objects
   */
  loadSpeechData(jsonPath) {
    try {
      const jsonData = fs.readFileSync(jsonPath, 'utf8');
      const speechData = JSON.parse(jsonData);
      
      if (!Array.isArray(speechData)) {
        throw new Error('Speech data must be an array');
      }
      
      // Validate required fields
      for (const item of speechData) {
        if (typeof item.start !== 'number' || typeof item.duration !== 'number') {
          throw new Error('Each speech item must have start and duration as numbers');
        }
      }
      
      return speechData.sort((a, b) => a.start - b.start);
    } catch (error) {
      throw new Error(`Error loading speech data: ${error.message}`);
    }
  }

  /**
   * Generate FFmpeg volume filter string for ducking
   * @param {Array} speechData - Array of speech segments
   * @param {number} totalDuration - Total duration of the audio in seconds
   * @returns {string} FFmpeg volume filter string
   */
  generateVolumeFilter(speechData, totalDuration) {
    const segments = [];
    let currentTime = 0;
    
    for (const speech of speechData) {
      const startTime = speech.start;
      const endTime = speech.start + speech.duration;
      
      // Add normal volume segment before speech (if any)
      if (currentTime < startTime) {
        segments.push({
          start: currentTime,
          end: startTime,
          volume: this.normalVolume
        });
      }
      
      // Add ducked volume segment during speech
      segments.push({
        start: startTime,
        end: endTime,
        volume: this.duckVolume
      });
      
      currentTime = endTime;
    }
    
    // Add final normal volume segment (if any)
    if (currentTime < totalDuration) {
      segments.push({
        start: currentTime,
        end: totalDuration,
        volume: this.normalVolume
      });
    }
    
    // Generate volume filter expressions
    const volumeExpressions = segments.map((segment, index) => {
      const duration = segment.end - segment.start;
      const fadeIn = index === 0 ? 0 : this.fadeInDuration;
      const fadeOut = index === segments.length - 1 ? 0 : this.fadeOutDuration;
      
      return `volume=${segment.volume}:enable='between(t,${segment.start},${segment.end})'`;
    }).join(',');
    
    return volumeExpressions;
  }

  /**
   * Get audio duration using FFmpeg
   * @param {string} audioPath - Path to the audio file
   * @returns {Promise<number>} Duration in seconds
   */
  getAudioDuration(audioPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }
        
        const duration = metadata.format.duration;
        resolve(duration);
      });
    });
  }

  /**
   * Process audio ducking
   * @param {string} musicPath - Path to the music file
   * @param {string} speechDataPath - Path to the speech data JSON file
   * @param {string} outputPath - Path for the output file
   * @returns {Promise<string>} Path to the output file
   */
  async processAudio(musicPath, speechDataPath, outputPath) {
    try {
      console.log('Loading speech data...');
      const speechData = this.loadSpeechData(speechDataPath);
      
      console.log('Getting audio duration...');
      const totalDuration = await this.getAudioDuration(musicPath);
      
      console.log('Generating volume filter...');
      const volumeFilter = this.generateVolumeFilter(speechData, totalDuration);
      
      console.log('Processing audio with ducking...');
      
      return new Promise((resolve, reject) => {
        const outputFilePath = path.resolve(outputPath);
        
        ffmpeg(musicPath)
          .audioFilters([
            // Apply volume changes with smooth transitions
            `volume=1.0,volume=${this.duckVolume}:enable='${this.buildEnableExpression(speechData)}'`
          ])
          .audioCodec('libmp3lame')
          .audioBitrate('192k')
          .on('start', (commandLine) => {
            console.log('FFmpeg command:', commandLine);
          })
          .on('progress', (progress) => {
            console.log(`Processing: ${Math.round(progress.percent || 0)}%`);
          })
          .on('end', () => {
            console.log('Audio ducking completed successfully!');
            resolve(outputFilePath);
          })
          .on('error', (err) => {
            console.error('Error processing audio:', err);
            reject(err);
          })
          .save(outputFilePath);
      });
    } catch (error) {
      throw new Error(`Audio processing failed: ${error.message}`);
    }
  }

  /**
   * Build enable expression for volume filter
   * @param {Array} speechData - Array of speech segments
   * @returns {string} Enable expression for FFmpeg
   */
  buildEnableExpression(speechData) {
    const expressions = speechData.map(speech => {
      const start = speech.start;
      const end = speech.start + speech.duration;
      return `between(t,${start},${end})`;
    });
    
    return expressions.join('+');
  }

  /**
   * Process audio with smooth ducking transitions
   * @param {string} musicPath - Path to the music file
   * @param {string} speechDataPath - Path to the speech data JSON file
   * @param {string} outputPath - Path for the output file
   * @returns {Promise<string>} Path to the output file
   */
  async processAudioSmooth(musicPath, speechDataPath, outputPath) {
    try {
      console.log('Loading speech data...');
      const speechData = this.loadSpeechData(speechDataPath);
      
      console.log('Processing audio with smooth ducking...');
      
      return new Promise((resolve, reject) => {
        const outputFilePath = path.resolve(outputPath);
        
        // Build complex filter for smooth volume transitions
        const volumePoints = this.buildVolumePoints(speechData);
        const volumeFilter = this.buildSmoothVolumeFilter(volumePoints);
        
        ffmpeg(musicPath)
          .complexFilter([
            volumeFilter
          ])
          .audioCodec('libmp3lame')
          .audioBitrate('192k')
          .on('start', (commandLine) => {
            console.log('FFmpeg command:', commandLine);
          })
          .on('progress', (progress) => {
            console.log(`Processing: ${Math.round(progress.percent || 0)}%`);
          })
          .on('end', () => {
            console.log('Audio ducking completed successfully!');
            resolve(outputFilePath);
          })
          .on('error', (err) => {
            console.error('Error processing audio:', err);
            reject(err);
          })
          .save(outputFilePath);
      });
    } catch (error) {
      throw new Error(`Audio processing failed: ${error.message}`);
    }
  }

  /**
   * Build volume points for smooth transitions
   * @param {Array} speechData - Array of speech segments
   * @returns {Array} Array of volume points
   */
  buildVolumePoints(speechData) {
    const points = [];
    let currentTime = 0;
    
    for (const speech of speechData) {
      const startTime = speech.start;
      const endTime = speech.start + speech.duration;
      
      // Add fade-out point before speech
      if (startTime > currentTime) {
        points.push({ time: Math.max(0, startTime - this.fadeOutDuration), volume: this.normalVolume });
        points.push({ time: startTime, volume: this.duckVolume });
      }
      
      // Add fade-in point after speech
      points.push({ time: endTime, volume: this.duckVolume });
      points.push({ time: endTime + this.fadeInDuration, volume: this.normalVolume });
      
      currentTime = endTime + this.fadeInDuration;
    }
    
    return points;
  }

  /**
   * Build smooth volume filter string
   * @param {Array} volumePoints - Array of volume points
   * @returns {string} Volume filter string
   */
  buildSmoothVolumeFilter(volumePoints) {
    const volumeExpressions = volumePoints.map(point => 
      `${point.volume}*between(t,${point.time},${point.time + 0.001})`
    ).join('+');
    
    return `volume='${volumeExpressions}'`;
  }
}

// Main execution function
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.log('Usage: node audio_ducking.js <music_file> <speech_data.json> <output_file>');
    console.log('Example: node audio_ducking.js music.mp3 speech_data.json output_ducked.mp3');
    process.exit(1);
  }
  
  const [musicPath, speechDataPath, outputPath] = args;
  
  // Check if input files exist
  if (!fs.existsSync(musicPath)) {
    console.error(`Error: Music file not found: ${musicPath}`);
    process.exit(1);
  }
  
  if (!fs.existsSync(speechDataPath)) {
    console.error(`Error: Speech data file not found: ${speechDataPath}`);
    process.exit(1);
  }
  
  try {
    const ducker = new AudioDucker({
      duckVolume: 0.2,        // 20% volume during speech
      normalVolume: 1.0,      // 100% volume normally
      fadeInDuration: 0.1,    // 100ms fade in
      fadeOutDuration: 0.1    // 100ms fade out
    });
    
    const result = await ducker.processAudio(musicPath, speechDataPath, outputPath);
    console.log(`\nSuccess! Ducked audio saved to: ${result}`);
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Export for use as a module
module.exports = AudioDucker;

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}